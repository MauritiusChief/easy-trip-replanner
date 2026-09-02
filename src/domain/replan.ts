import { MS_PER_MINUTE, TIME_STEP_MINUTES } from './config'
import { getTripDayWindow } from './current'
import { haversineKm } from './geo'
import { dayKeyToUtcEpoch, roundEpochToStep } from './time'
import { collectDayWarnings } from './warnings'
import type {
  AlternativePlace,
  DateISO,
  EpochMs,
  GeoPoint,
  Leg,
  MinuteOfDay,
  PlaceId,
  PlaceSlot,
  PlanWarning,
  ReplanDraft,
  TransportSlot,
  Trip,
} from './types'

/**
 * 当天局部自动重排引擎（需求 5，阶段 3 核心）。
 *
 * 纯计算模块：输入当天计划、当前时刻、是否启用备选地点，
 * 输出一份可被采纳或放弃的草案（ReplanDraft），绝不直接修改计划。
 *
 * 算法（对应需求 5.3/5.4 的优先级）：
 * 1. 锁定重排起点之前的行程（含"此刻正在进行"的停留/交通及其目的地），
 *    只重排当天剩余部分，不跨日
 * 2. 固定开始时间地点作为硬锚点：精确落在固定时刻，把剩余时间切成若干分段
 * 3. 弹性地点按"优先级 → 同级近邻"排序，逐段贪心排入：
 *    - 时间不足时优先保护高优先级地点的完整停留
 *    - 低优先级地点向下压缩，最低到最短停留
 *    - 仍排不下：可取消地点取消；不可取消地点记入不可行原因
 *    - 开放时间作为排入约束（推迟到开门时间，超出关门则尝试压缩/放弃）
 * 4. 交通时长永远沿用用户设定（需求 4.4）：路线变化只改变 from/to 快照，
 *    隐含速度由警告层重算比较；时长不由速度反推
 * 5. 排完后跑一遍通用警告检查（速度异常/绕路/重叠等）并入草案
 *
 * 路线策略 v1 为"同级近邻"贪心；config.ROUTE_EXACT_MAX_PLACES 预留的
 * 有限排列搜索留待阶段 5 调参时评估收益。
 */

/** 新交通没有用户基准时的默认时长；备选地点换入时同源（需求 4.4 由用户事后调整）。 */
const DEFAULT_TRANSPORT_MINUTES = 30

/** 引擎内部的排程候选：来自原计划地点或其备选。 */
interface Candidate {
  /** 排入计划后使用的地点 id（备选用自己的 id）。 */
  id: PlaceId
  /** 所属原地点 id（备选替换时用于标记取消）。 */
  basePlaceId: PlaceId
  name: string
  location: GeoPoint
  priority: number
  open: MinuteOfDay | null
  close: MinuteOfDay | null
  minStay: number | null
  maxStay: number | null
  fixedStart: MinuteOfDay | null
  /** 原计划的停留时长（备选无既定值时取默认）。 */
  currentDuration: number
  /** 用户为该段设定的交通时长基准（需求 4.4：只沿用，不反推）。 */
  transportDuration: number
  transportBaseSpeed: number | null
  /** 启用备选时，日级库中链接到本地点的替代候选（按优先级升序）。 */
  alternatives: AlternativePlace[]
}

/** 一次成功排入的结果。 */
interface Placement {
  candidate: Candidate
  placeStart: EpochMs
  durationMinutes: number
  transportDuration: number
}

/** 固定锚点切出的可填充时间段（均在当日窗口内）。 */
interface Segment {
  dayKey: DateISO
  start: EpochMs
  end: EpochMs
  cursor: EpochMs
}

function legEnd(leg: Leg): EpochMs {
  return leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
}

/** 分钟数向下取整到 5 分钟网格（用于压缩后的停留时长）。 */
function floorToStep(minutes: number): number {
  return Math.floor(minutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES
}

function candidateFromLeg(leg: Leg): Candidate {
  return {
    id: leg.place.id,
    basePlaceId: leg.place.id,
    name: leg.place.name,
    location: leg.place.location,
    priority: leg.place.priority,
    open: leg.place.open,
    close: leg.place.close,
    minStay: leg.place.minStayMinutes,
    maxStay: leg.place.maxStayMinutes,
    fixedStart: leg.place.fixedStart,
    currentDuration: leg.place.durationMinutes,
    transportDuration: leg.transport
      ? leg.transport.durationMinutes
      : DEFAULT_TRANSPORT_MINUTES,
    transportBaseSpeed: leg.transport ? leg.transport.baseSpeedKmh : null,
    alternatives: [],
  }
}

function candidateFromAlternative(alt: AlternativePlace, base: Candidate): Candidate {
  return {
    id: alt.id,
    basePlaceId: base.basePlaceId,
    name: alt.name,
    location: alt.location,
    priority: alt.priority,
    open: alt.open,
    close: alt.close,
    minStay: alt.minStayMinutes,
    maxStay: alt.maxStayMinutes,
    fixedStart: null,
    // 备选自己的计划停留时长（属性独立）；交通时长沿用默认值
    currentDuration: alt.durationMinutes,
    transportDuration: DEFAULT_TRANSPORT_MINUTES,
    transportBaseSpeed: null,
    alternatives: [],
  }
}

/**
 * 确定重排起点：
 * - 已结束的行程段（停留结束 ≤ now）进入锁定前缀
 * - "此刻正在进行"的段（停留内或前往它的交通内）整体保留，
 *   其目的地也计入前缀（当前活动不被重排）
 */
function resolvePrefix(day: { legs: Leg[] }, now: EpochMs): number {
  let doneCount = 0
  let activeIndex = -1
  day.legs.forEach((leg, i) => {
    const transportEnd = leg.transport
      ? leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
      : null
    if (
      leg.transport &&
      transportEnd !== null &&
      now >= leg.transport.start &&
      now < transportEnd
    ) {
      activeIndex = i
    }
    if (now >= leg.place.start && now < legEnd(leg)) {
      activeIndex = i
    }
    if (legEnd(leg) <= now) doneCount = i + 1
  })
  return activeIndex >= 0 ? Math.max(doneCount, activeIndex + 1) : doneCount
}

/**
 * 同优先级内以近邻排序（贪心近邻策略），优先级高的组整体在前（需求 5.3）。
 */
function orderForSegment(pending: Candidate[], from: GeoPoint | null): Candidate[] {
  const sorted = [...pending].sort((a, b) => a.priority - b.priority)
  const groups: Candidate[][] = []
  for (const candidate of sorted) {
    const group = groups[groups.length - 1]
    if (group && group[0].priority === candidate.priority) group.push(candidate)
    else groups.push([candidate])
  }
  const result: Candidate[] = []
  for (const group of groups) {
    if (!from) {
      result.push(...group)
      continue
    }
    const rest = [...group]
    let cursorLocation = from
    while (rest.length > 0) {
      let bestIndex = 0
      let bestDistance = Number.POSITIVE_INFINITY
      rest.forEach((candidate, index) => {
        const distance = haversineKm(cursorLocation, candidate.location)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
      const [chosen] = rest.splice(bestIndex, 1)
      result.push(chosen)
      cursorLocation = chosen.location
    }
  }
  return result
}

/**
 * 尝试把候选排入分段的当前游标处。
 * 返回 placement 并推进游标；放不下（窗口/关门/压缩后仍不够）返回 null。
 */
function tryPlace(candidate: Candidate, segment: Segment, timeZone: string): Placement | null {
  if (segment.cursor >= segment.end) return null
  let start = segment.cursor + candidate.transportDuration * MS_PER_MINUTE
  if (candidate.open !== null) {
    start = Math.max(start, dayKeyToUtcEpoch(segment.dayKey, candidate.open, timeZone))
  }
  let duration = candidate.currentDuration
  if (candidate.minStay !== null) duration = Math.max(duration, candidate.minStay)
  if (candidate.maxStay !== null) duration = Math.min(duration, candidate.maxStay)
  let endLimit = segment.end
  if (candidate.close !== null) {
    endLimit = Math.min(endLimit, dayKeyToUtcEpoch(segment.dayKey, candidate.close, timeZone))
  }
  if (start + duration * MS_PER_MINUTE > endLimit) {
    if (candidate.minStay !== null) {
      const compressed = floorToStep((endLimit - start) / MS_PER_MINUTE)
      if (compressed >= candidate.minStay) {
        duration = compressed
      } else {
        return null
      }
    } else {
      return null
    }
  }
  const placement: Placement = {
    candidate,
    placeStart: roundEpochToStep(start),
    durationMinutes: floorToStep(duration),
    transportDuration: candidate.transportDuration,
  }
  segment.cursor = placement.placeStart + placement.durationMinutes * MS_PER_MINUTE
  return placement
}

/**
 * 生成当天剩余行程的重排草案。
 *
 * @param trip 完整行程（提供时区、窗口、按日覆盖）
 * @param dayKey 要重排的日历日
 * @param now 当前时刻（可为调试面板虚构的时间），决定锁定前缀
 * @param includeAlternatives 是否把备选地点纳入候选（需求 7.3）
 */
export function buildReplanDraft(
  trip: Trip,
  dayKey: DateISO,
  now: EpochMs,
  includeAlternatives: boolean,
): ReplanDraft {
  const timeZone = trip.timezone
  const emptyWarnings: PlanWarning[] = []
  const fail = (reason: string): ReplanDraft => ({
    day: dayKey,
    fromLegIndex: 0,
    legs: [],
    cancelledPlaceIds: [],
    warnings: emptyWarnings,
    infeasibleReasons: [reason],
    createdAt: Date.now(),
  })

  const day = trip.days.find((entry) => entry.date === dayKey)
  if (!day) return fail('当日没有行程，无可重排内容')

  const window = getTripDayWindow(trip, dayKey)
  const prefixCount = resolvePrefix(day, now)
  const prefixLegs = day.legs.slice(0, prefixCount)
  const prefixLast = prefixLegs.length > 0 ? prefixLegs[prefixLegs.length - 1] : null
  let earliest =
    prefixLast !== null
      ? legEnd(prefixLast)
      : roundEpochToStep(Math.max(now, window.startUtc))
  earliest = roundEpochToStep(earliest)

  if (earliest >= window.endUtc) {
    return fail('当日行程已结束，没有可重排的剩余行程')
  }

  const regionLegs = day.legs.slice(prefixCount)
  if (regionLegs.length === 0) {
    return fail('重排起点之后没有待安排的行程')
  }

  const warnings: PlanWarning[] = []
  const infeasibleReasons: string[] = []
  const cancelledPlaceIds: PlaceId[] = []

  // 候选 = 剩余地点；启用备选时从日级备选库取"链接命中重排区间地点"的
  // 条目挂到对应候选上（需求 7.2/7.3：平时不参与，链接到锁定前缀的不参与）
  const candidates = regionLegs.map(candidateFromLeg)
  if (includeAlternatives) {
    const regionIds = new Set(regionLegs.map((leg) => leg.place.id))
    const library = day.alternatives
      .filter(
        (entry) => entry.linkedPlaceId !== null && regionIds.has(entry.linkedPlaceId),
      )
      .sort((a, b) => a.priority - b.priority)
    for (const candidate of candidates) {
      candidate.alternatives = library.filter(
        (entry) => entry.linkedPlaceId === candidate.id,
      )
    }
  }

  // 固定锚点：精确排程，切分时间分段（需求 3.2 / 5.3 第一优先级）
  const anchorCandidates = candidates.filter(
    (candidate): candidate is Candidate & { fixedStart: MinuteOfDay } =>
      candidate.fixedStart !== null,
  )
  const flexible = candidates.filter((candidate) => candidate.fixedStart === null)

  const anchorPlacements: Placement[] = []
  const segments: Segment[] = []
  let segmentStart = earliest
  const sortedAnchors = [...anchorCandidates].sort(
    (a, b) =>
      dayKeyToUtcEpoch(dayKey, a.fixedStart, timeZone) -
      dayKeyToUtcEpoch(dayKey, b.fixedStart, timeZone),
  )
  for (const anchor of sortedAnchors) {
    const anchorStart = dayKeyToUtcEpoch(dayKey, anchor.fixedStart, timeZone)
    let duration = anchor.currentDuration
    if (anchor.minStay !== null) duration = Math.max(duration, anchor.minStay)
    if (anchor.maxStay !== null) duration = Math.min(duration, anchor.maxStay)
    if (anchorStart < earliest) {
      infeasibleReasons.push(
        `「${anchor.name}」的固定时间（${anchor.fixedStart} 分钟）已过，无法保留`,
      )
      cancelledPlaceIds.push(anchor.id)
      continue
    }
    // 锚点自身的交通也需要时间：前一分段必须在其交通出发前结束，
    // 否则会产生"前一地点停留与锚点交通重叠"的冲突
    segments.push({
      dayKey,
      start: segmentStart,
      end: anchorStart - anchor.transportDuration * MS_PER_MINUTE,
      cursor: segmentStart,
    })
    segmentStart = anchorStart + duration * MS_PER_MINUTE
    anchorPlacements.push({
      candidate: anchor,
      placeStart: anchorStart,
      durationMinutes: duration,
      transportDuration: anchor.transportDuration,
    })
  }
  segments.push({ dayKey, start: segmentStart, end: window.endUtc, cursor: segmentStart })

  // 弹性地点：逐段贪心排入（优先级 → 同级近邻），放不下留在 pending 进入下一段
  const pending = [...flexible]
  const flexPlacements: Placement[] = []
  let lastLocation: GeoPoint | null = prefixLast ? prefixLast.place.location : null
  for (const segment of segments) {
    if (pending.length === 0) break
    const ordered = orderForSegment(pending, lastLocation)
    for (const candidate of ordered) {
      if (!pending.includes(candidate)) continue
      if (segment.cursor >= segment.end) break
      const placement = tryPlace(candidate, segment, timeZone)
      if (placement) {
        flexPlacements.push(placement)
        pending.splice(pending.indexOf(candidate), 1)
        lastLocation = candidate.location
      }
    }
  }

  // 主排程放不下的候选：先尝试备选替换（需求 7.1/7.3），否则取消或记为不可行
  for (const candidate of pending) {
    let placed = false
    if (candidate.alternatives.length > 0) {
      for (const alt of candidate.alternatives) {
        const altCandidate = candidateFromAlternative(alt, candidate)
        for (const segment of segments) {
          const placement = tryPlace(altCandidate, segment, timeZone)
          if (placement) {
            flexPlacements.push(placement)
            warnings.push({
              kind: 'replan-note',
              day: dayKey,
              message: `「${candidate.name}」无法安排，已替换为备选「${altCandidate.name}」`,
            })
            placed = true
            break
          }
        }
        if (placed) break
      }
    }
    if (placed) {
      cancelledPlaceIds.push(candidate.basePlaceId)
    } else if (candidate.minStay === null) {
      cancelledPlaceIds.push(candidate.id)
      warnings.push({
        kind: 'replan-note',
        day: dayKey,
        message: `「${candidate.name}」已取消（剩余时间不足）`,
      })
    } else {
      infeasibleReasons.push(`「${candidate.name}」无法在剩余时间内安排（时间不足）`)
    }
  }

  // 压缩提示：实际停留短于原计划的段落
  for (const placement of flexPlacements) {
    if (placement.durationMinutes < placement.candidate.currentDuration) {
      warnings.push({
        kind: 'min-stay',
        day: dayKey,
        message: `「${placement.candidate.name}」停留被压缩至 ${placement.durationMinutes} 分钟（原 ${placement.candidate.currentDuration} 分钟）`,
      })
    }
  }

  // 组装草案段落（锚点 + 弹性地点按时间排序；交通沿用用户时长，快照指向新前序）
  const allPlacements = [...anchorPlacements, ...flexPlacements].sort(
    (a, b) => a.placeStart - b.placeStart,
  )
  const draftLegs: Leg[] = []
  let hasPredecessor = prefixLast !== null
  // 第一段草案的交通出发地 = 锁定前缀最后地点（而非最后一个已排地点）
  let cursorLocation: GeoPoint | null = prefixLast ? prefixLast.place.location : null
  for (const placement of allPlacements) {
    const { candidate } = placement
    let transport: TransportSlot | null = null
    if (hasPredecessor && cursorLocation) {
      transport = {
        start: placement.placeStart - placement.transportDuration * MS_PER_MINUTE,
        durationMinutes: placement.transportDuration,
        from: cursorLocation,
        to: candidate.location,
        baseSpeedKmh: candidate.transportBaseSpeed,
      }
    }
    const place: PlaceSlot = {
      id: candidate.id,
      name: candidate.name,
      location: candidate.location,
      priority: candidate.priority,
      start: placement.placeStart,
      durationMinutes: placement.durationMinutes,
      open: candidate.open,
      close: candidate.close,
      minStayMinutes: candidate.minStay,
      maxStayMinutes: candidate.maxStay,
      fixedStart: candidate.fixedStart,
    }
    draftLegs.push({ transport, place })
    hasPredecessor = true
    cursorLocation = candidate.location
  }

  // 通用警告复查：速度异常（前序变化后隐含速度 vs 基准）、绕路、重叠等
  const fullLegs = [...prefixLegs, ...draftLegs]
  const genericWarnings = collectDayWarnings(trip, { ...day, legs: fullLegs })

  return {
    day: dayKey,
    fromLegIndex: prefixCount,
    legs: draftLegs,
    cancelledPlaceIds,
    warnings: [...warnings, ...genericWarnings],
    infeasibleReasons,
    createdAt: Date.now(),
  }
}
