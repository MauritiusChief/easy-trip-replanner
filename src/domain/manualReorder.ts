import { MS_PER_MINUTE } from './config'
import { haversineKm, impliedSpeedKmh } from './geo'
import { classifyReorderScope, orderByStartTime, resolveNextPredecessor } from './reorderRules'
import { roundEpochToStep, roundMinutesToStep } from './time'
import type {
  DateISO,
  EpochMs,
  Leg,
  PlaceId,
  PlaceSlot,
  Trip,
} from './types'

/**
 * 手动重排领域模块（重构阶段 1）。
 *
 * 职责：为"用户逐张选择当天剩余地点，并即时填写时间和通勤"提供纯领域操作。
 * 不做路径搜索、自动排序、自动压缩、自动取消或备选替换。
 *
 * - ManualReorderSession 只存在于 Zustand/UI 内存中，绝不写入 Trip 或
 *   localStorage：会话丢失仅影响未处理卡片的 UI 状态，正式行程不受影响。
 * - 保存走一个原子 mutation（withManualReorderSaved）：一次更新内完成
 *   时间/交通改写、坐标快照同步、后续交通出发地同步和稳定排序。
 * - 冲突不是保存前置条件：保存后由界面基于新 Trip 用 collectDayWarnings
 *   重新计算并展示警告（DayView 已按 trip 引用 useMemo 重算）。
 */

/**
 * 手动重排会话（内存态）。
 * 字段在会话启动时冻结（目标日期、锁定范围、待选集合），
 * 只有选择顺序（processedPlaceIds / currentPlaceId）随用户操作推进。
 */
export interface ManualReorderSession {
  /** 目标日期。 */
  dayKey: DateISO
  /** 锁定范围：会话启动时锁定前缀的段数（classifyReorderScope 的 lockedPrefix）。 */
  lockedPrefixCount: number
  /** 锁定前缀最后地点的快照；无锁定前缀时为 null（R3 首卡判定依据）。 */
  prefixLast: PlaceSlot | null
  /** 待选地点 id，保持会话启动时的时间轴顺序。 */
  pendingPlaceIds: PlaceId[]
  /** 已处理地点 id，按用户选择顺序追加（R2 选择顺序的唯一记录）。 */
  processedPlaceIds: PlaceId[]
  /** 当前正在处理的卡片；null 表示未打开任何输入。 */
  currentPlaceId: PlaceId | null
}

/** 启动会话：按 R1 切分锁定前缀与待选集合。当天不存在或没有待选时返回 null。 */
export function startManualReorderSession(
  trip: Trip,
  dayKey: DateISO,
  now: EpochMs,
): ManualReorderSession | null {
  const day = trip.days.find((entry) => entry.date === dayKey)
  if (!day) return null
  const scope = classifyReorderScope(day, now)
  if (scope.pending.length === 0) return null
  return {
    dayKey,
    lockedPrefixCount: scope.lockedPrefix.length,
    prefixLast:
      scope.lockedPrefix.length > 0
        ? scope.lockedPrefix[scope.lockedPrefix.length - 1].place
        : null,
    pendingPlaceIds: scope.pending.map((leg) => leg.place.id),
    processedPlaceIds: [],
    currentPlaceId: null,
  }
}

/** 会话启动后仍未处理的待选地点（保持原时间轴顺序）。 */
export function remainingPendingIds(session: ManualReorderSession): PlaceId[] {
  const processed = new Set(session.processedPlaceIds)
  return session.pendingPlaceIds.filter((id) => !processed.has(id))
}

/** 打开/切换/关闭当前卡片（纯函数，返回新会话对象）。 */
export function withCurrentCard(
  session: ManualReorderSession,
  placeId: PlaceId | null,
): ManualReorderSession {
  if (placeId !== null && !remainingPendingIds(session).includes(placeId)) {
    return session
  }
  return { ...session, currentPlaceId: placeId }
}

/** 保存成功后标记该地点为已处理，并关闭当前卡片。 */
export function withPlaceProcessed(
  session: ManualReorderSession,
  placeId: PlaceId,
): ManualReorderSession {
  if (!session.pendingPlaceIds.includes(placeId)) return session
  if (session.processedPlaceIds.includes(placeId)) return session
  return {
    ...session,
    processedPlaceIds: [...session.processedPlaceIds, placeId],
    currentPlaceId:
      session.currentPlaceId === placeId ? null : session.currentPlaceId,
  }
}

/** 手动保存输入：用户逐张填写的内容；前序地点由会话推导（resolveSessionPredecessor）。 */
export interface ManualReorderSave {
  /** 被保存的待选地点 id。 */
  placeId: PlaceId
  /** 用户填写的新开始时间（5 分钟粒度，域内再取整兜底）。 */
  start: EpochMs
  /** 用户填写的到达交通时长（分钟）。 */
  transportDurationMinutes: number
}

/**
 * 由会话推导保存时的前序地点（R3）：最近一次保存的地点优先，
 * 否则锁定前缀最后地点，否则没有可确定前序（保存后该段无交通 slot）。
 * 已处理地点从当前 Trip 取最新 slot（含本次会话已改写的时间和坐标）。
 */
export function resolveSessionPredecessor(
  trip: Trip,
  session: ManualReorderSession,
): PlaceSlot | null {
  const day = trip.days.find((entry) => entry.date === session.dayKey)
  const slotById = (id: PlaceId): PlaceSlot | null =>
    day?.legs.find((leg) => leg.place.id === id)?.place ?? null
  const processed = session.processedPlaceIds
    .map(slotById)
    .filter((slot): slot is PlaceSlot => slot !== null)
  return resolveNextPredecessor(processed, session.prefixLast)
}

/**
 * 原子 mutation：把一次手动选择写入正式行程。一次更新内完成：
 *
 * 1. 更新被选地点的开始时间（保留其余地点属性）。
 * 2. 按用户填写的到达交通时长重建该段交通：
 *    from = 前序地点坐标、to = 本地点坐标、start = 新开始时间 - 时长；
 *    时长是用户手动输入，按需求 4.4 以"新距离 + 新时长"重算隐含速度基准。
 *    没有可确定前序（R3 首卡）时不创建交通 slot。
 * 3. 按开始时间稳定排序当天 legs（R2：相同开始时间保留选择顺序），
 *    同步新数组中相邻后一段交通的出发地快照。
 * 4. 直接写入正式行程；未选择地点、固定锚点（R4：锚点不可经本 mutation 移动，
 *    传入锚点 id 时原样返回）和备选库关联全部保留。
 */
export function withManualReorderSaved(
  trip: Trip,
  dayKey: DateISO,
  save: ManualReorderSave,
  predecessor: PlaceSlot | null,
): Trip {
  let changed = false
  const days = trip.days.map((day) => {
    if (day.date !== dayKey) return day
    const index = day.legs.findIndex((leg) => leg.place.id === save.placeId)
    if (index < 0) return day
    const target = day.legs[index]
    if (target.place.fixedStart !== null) return day
    const start = roundEpochToStep(save.start)
    const durationMinutes = roundMinutesToStep(
      Math.max(0, save.transportDurationMinutes),
    )
    const place: PlaceSlot = { ...target.place, start }
    const transport =
      predecessor === null
        ? null
        : {
            start: start - durationMinutes * MS_PER_MINUTE,
            durationMinutes,
            from: predecessor.location,
            to: place.location,
            baseSpeedKmh: impliedSpeedKmh(
              haversineKm(predecessor.location, place.location),
              durationMinutes,
            ),
          }
    const replaced: Leg[] = [...day.legs]
    replaced[index] = { transport, place }
    const sorted = orderByStartTime(replaced, (leg) => leg.place.start)
    const savedIndex = sorted.findIndex((leg) => leg.place.id === save.placeId)
    const following = sorted[savedIndex + 1]
    if (following?.transport) {
      sorted[savedIndex + 1] = {
        ...following,
        transport: { ...following.transport, from: place.location },
      }
    }
    changed = true
    return { ...day, legs: sorted }
  })
  return changed ? { ...trip, days } : trip
}
