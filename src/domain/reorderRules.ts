import { MS_PER_MINUTE } from './config'
import type { EpochMs, GeoPoint, Leg, PlaceSlot } from './types'

/**
 * 手动重排规则收口（重构阶段 0）。
 *
 * 本模块只定义规则与纯函数，不做任何排程或自动调整：
 *
 * R1 范围判定：已结束或正在进行的段落（含前往它的交通及其目的地）构成
 *    锁定前缀；剩余区域中 fixedStart 非 null 的地点是锁定锚点；
 *    其余地点进入待选卡槽。固定时间、已结束和进行中的地点永不进入待选卡槽。
 *
 * R2 顺序规则：用户填写的开始时间是正式时间轴顺序的唯一依据；
 *    用户选择顺序仅决定"正在处理的卡片"和"下一张卡的默认前序参考"。
 *    开始时间相同或与选择顺序倒置时，保存后稳定保留选择顺序作为数组顺序，
 *    重叠与顺序冲突交给警告层（collectDayWarnings）表达，不做隐式调整。
 *
 * R3 交通前序规则：第一张可调整卡没有可确定前序地点（无锁定前缀、
 *    也无更早保存的地点）时不创建交通 slot；有锁定前缀时以锁定前缀
 *    最后地点为前序；此后每张卡的默认前序是最近一次保存的地点。
 *
 * R4 锚点不动规则：锁定锚点不因相邻可调整地点的保存而移动，
 *    也不移动其他地点；由此产生的冲突只通过时间数据和警告表达。
 */

/** 手动重排范围内单段行程的归类。 */
export type ReorderCategory =
  /** 锁定：已结束或正在进行（含前往它的交通），不参与重排。 */
  | 'locked'
  /** 锚点：剩余区域中的固定开始时间地点，不进入待选卡槽，也不被移动。 */
  | 'anchored'
  /** 待选：剩余区域中的弹性地点，进入待选卡槽。 */
  | 'pending'

/** 段落的结束时刻（停留结束）。 */
function legEnd(leg: Leg): EpochMs {
  return leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
}

/** 单段归类：锁定优先于锚点——已结束/进行中的固定地点也在前缀里。 */
export function classifyLeg(leg: Leg, now: EpochMs): ReorderCategory {
  const transportEnd =
    leg.transport !== null
      ? leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
      : null
  const transportActive =
    leg.transport !== null &&
    transportEnd !== null &&
    now >= leg.transport.start &&
    now < transportEnd
  const placeActive = now >= leg.place.start && now < legEnd(leg)
  if (transportActive || placeActive || legEnd(leg) <= now) return 'locked'
  if (leg.place.fixedStart !== null) return 'anchored'
  return 'pending'
}

/** 一次范围判定结果。各数组内均保持原时间轴顺序。 */
export interface ReorderScope {
  /** 锁定前缀：时间轴开头连续的已结束/进行中段落。 */
  lockedPrefix: Leg[]
  /** 锁定锚点：剩余区域中的固定开始时间地点（保持时间轴顺序，R4 不移动）。 */
  anchors: Leg[]
  /** 待选卡槽：剩余区域中的弹性地点。 */
  pending: Leg[]
  /** 锁定前缀最后地点的坐标；无锁定前缀时为 null（R3 的首卡判定依据）。 */
  prefixLastLocation: GeoPoint | null
}

/**
 * R1 的整日版本：把当天行程切成锁定前缀、锚点和待选三部分。
 * 前缀推导语义（与各处"当前位置"扫描一致）：
 * done = 停留已结束；active = now 落在交通或停留区间内；
 * 前缀长度 = max(连续 done 数, active 下标 + 1)。
 */
export function classifyReorderScope(
  day: { legs: Leg[] },
  now: EpochMs,
): ReorderScope {
  let doneCount = 0
  let activeIndex = -1
  day.legs.forEach((leg, i) => {
    const transportEnd =
      leg.transport !== null
        ? leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
        : null
    if (
      leg.transport !== null &&
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
  const prefixCount = activeIndex >= 0 ? Math.max(doneCount, activeIndex + 1) : doneCount

  const lockedPrefix = day.legs.slice(0, prefixCount)
  const anchors: Leg[] = []
  const pending: Leg[] = []
  for (const leg of day.legs.slice(prefixCount)) {
    if (leg.place.fixedStart !== null) anchors.push(leg)
    else pending.push(leg)
  }
  return {
    lockedPrefix,
    anchors,
    pending,
    prefixLastLocation:
      lockedPrefix.length > 0
        ? lockedPrefix[lockedPrefix.length - 1].place.location
        : null,
  }
}

/**
 * R2 的正式时间轴排序：按开始时间升序；开始时间相同（或与输入顺序倒置）
 * 时稳定保留输入顺序。保存时输入顺序即用户选择顺序，因此相等/倒置时刻
 * 数组顺序可预期，不依赖任何临时判断。
 */
export function orderByStartTime<T>(items: readonly T[], getStart: (item: T) => EpochMs): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => getStart(a.item) - getStart(b.item) || a.index - b.index)
    .map((entry) => entry.item)
}

/**
 * R3：推导下一张卡的默认交通前序。
 * 已保存地点按用户选择顺序传入；规则为"最近一次保存的地点优先，
 * 否则锁定前缀最后地点，否则没有可确定前序"。
 * 返回 null 表示不创建交通 slot（首卡且无锁定前缀）。
 */
export function resolveNextPredecessor(
  processedInSelectionOrder: readonly PlaceSlot[],
  prefixLast: PlaceSlot | null,
): PlaceSlot | null {
  const lastProcessed = processedInSelectionOrder[processedInSelectionOrder.length - 1]
  return lastProcessed ?? prefixLast
}
