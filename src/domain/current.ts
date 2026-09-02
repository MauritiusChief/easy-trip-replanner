import { MS_PER_MINUTE } from './config'
import { getDayWindowUtc, getZonedDayKey } from './time'
import type { AlternativePlace, DateISO, EpochMs, PlaceId, Trip } from './types'
import type { Leg } from './types'

/**
 * "当前时间在计划中的位置"（需求 9）：由当前时间 + 计划纯推导，
 * 不维护任何现实执行状态。各分支语义：
 * - before-trip / after-trip：今天早于/晚于旅行日期范围
 * - no-plan：日期在范围内但当天没有 DayPlan 数据
 * - before-day / after-day：在当日窗口之外
 * - gap：在窗口内但没有任何 slot 覆盖此刻（空档）
 * - transport：正处于前往某地点的交通段，arriveUtc 为应到达时刻
 * - place：正处于某地点停留内，leaveUtc 为应离开时刻
 */
export type CurrentPosition =
  | { kind: 'before-trip' }
  | { kind: 'after-trip' }
  | { kind: 'no-plan'; dayKey: DateISO }
  | { kind: 'before-day'; dayKey: DateISO; startUtc: EpochMs }
  | { kind: 'after-day'; dayKey: DateISO }
  | { kind: 'gap'; dayKey: DateISO }
  | {
      kind: 'transport'
      dayKey: DateISO
      legIndex: number
      destinationId: PlaceId
      arriveUtc: EpochMs
    }
  | {
      kind: 'place'
      dayKey: DateISO
      legIndex: number
      placeId: PlaceId
      leaveUtc: EpochMs
    }

/**
 * 取某日的可规划窗口：单日覆盖优先，否则用旅行级统一窗口。
 * 供当前位置推导与日视图共同使用，保证两处窗口一致。
 */
export function getTripDayWindow(
  trip: Trip,
  dayKey: DateISO,
): { startUtc: EpochMs; endUtc: EpochMs } {
  const override = trip.dayOverrides[dayKey]
  return getDayWindowUtc(
    dayKey,
    override?.start ?? trip.dailyStart,
    override?.end ?? trip.dailyEnd,
    trip.timezone,
  )
}

/** 按日期键与下标查找某段行程，找不到（数据不一致）时返回 undefined。 */
export function findLeg(trip: Trip, dayKey: DateISO, legIndex: number): Leg | undefined {
  return trip.days.find((day) => day.date === dayKey)?.legs[legIndex]
}

/** 按日期键与 id 查找备选库条目，找不到（已删除）时返回 undefined。 */
export function findAlternative(
  trip: Trip,
  dayKey: DateISO,
  altId: PlaceId,
): AlternativePlace | undefined {
  return trip.days
    .find((day) => day.date === dayKey)
    ?.alternatives.find((entry) => entry.id === altId)
}

/**
 * 推导"现在应该在计划中的什么位置"。
 * 算法：先按日期键定位当天 → 判断是否在窗口内 → 顺序扫描各段行程，
 * 返回第一个覆盖 now 的交通或停留；都不覆盖则为空档。
 * 若数据存在重叠，按扫描顺序先到先得（重叠本身由校验层警告）。
 */
export function getCurrentPosition(trip: Trip, now: EpochMs): CurrentPosition {
  const dayKey = getZonedDayKey(now, trip.timezone)
  if (dayKey < trip.startDate) return { kind: 'before-trip' }
  if (dayKey > trip.endDate) return { kind: 'after-trip' }
  const day = trip.days.find((entry) => entry.date === dayKey)
  if (!day) return { kind: 'no-plan', dayKey }
  const { startUtc, endUtc } = getTripDayWindow(trip, dayKey)
  if (now < startUtc) return { kind: 'before-day', dayKey, startUtc }
  if (now >= endUtc) return { kind: 'after-day', dayKey }
  for (let index = 0; index < day.legs.length; index++) {
    const leg = day.legs[index]
    if (leg.transport) {
      const arriveUtc = leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
      if (now >= leg.transport.start && now < arriveUtc) {
        return {
          kind: 'transport',
          dayKey,
          legIndex: index,
          destinationId: leg.place.id,
          arriveUtc,
        }
      }
    }
    const leaveUtc = leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
    if (now >= leg.place.start && now < leaveUtc) {
      return { kind: 'place', dayKey, legIndex: index, placeId: leg.place.id, leaveUtc }
    }
  }
  return { kind: 'gap', dayKey }
}
