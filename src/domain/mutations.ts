import { MS_PER_MINUTE } from './config'
import { getTripDayWindow } from './current'
import { haversineKm, impliedSpeedKmh } from './geo'
import { addMinutes } from './time'
import type {
  AlternativePlace,
  DateISO,
  EpochMs,
  Leg,
  PlaceSlot,
  ReplanDraft,
  TransportSlot,
  Trip,
} from './types'

/**
 * 编辑操作的纯函数集合（需求 8.1）：所有对计划的修改都通过这里生成新的 Trip，
 * 不做任何"顺手修正"——编辑造成的空档、重叠由警告层显式呈现（需求 8.2）。
 *
 * 贯彻需求 4.4 的语义：交通时长永远不由速度反推；
 * 路线变化时只同步 from/to 坐标快照，时长与基准速度保持不变，
 * 由 warnings 层重算隐含速度并与基准比较来提示用户。
 */

/** 新插入地点的默认交通时长（分钟）。新交通没有用户基准，交给用户手动调整。 */
const DEFAULT_INSERT_TRANSPORT_MINUTES = 30
/** 新插入地点的默认停留时长（分钟）。 */
const DEFAULT_INSERT_STAY_MINUTES = 60
/** 新插入地点的默认优先级。 */
const DEFAULT_INSERT_PRIORITY = 5

/** 段落的结束时刻（停留结束）。 */
function legEnd(leg: Leg): EpochMs {
  return leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
}

/** 对某一天的行程段做不可变映射，其余日期保持引用不变。 */
function mapDay(trip: Trip, dayKey: DateISO, mapLegs: (legs: Leg[]) => Leg[]): Trip {
  return {
    ...trip,
    days: trip.days.map((day) =>
      day.date === dayKey ? { ...day, legs: mapLegs(day.legs) } : day,
    ),
  }
}

/**
 * 用户手动修改交通时长后的交通 slot：
 * 时长取新值，基准速度按"当前距离 + 新时长"重算（需求 4.4）。
 */
function transportWithDuration(
  leg: Leg,
  durationMinutes: number,
): TransportSlot | null {
  if (!leg.transport) return null
  const distanceKm = haversineKm(leg.transport.from, leg.place.location)
  return {
    ...leg.transport,
    durationMinutes,
    baseSpeedKmh: impliedSpeedKmh(distanceKm, durationMinutes),
  }
}

/**
 * 保存地点编辑：
 * - 更新地点字段与备选地点
 * - 同步坐标快照：自身交通的 to、下一段交通的 from 指向新坐标
 *   （时长与基准速度不动，坐标变化导致的速度偏差由警告层提示）
 */
export function withPlaceSaved(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
  place: PlaceSlot,
  alternatives: AlternativePlace[],
): Trip {
  return mapDay(trip, dayKey, (legs) =>
    legs.map((leg, i) => {
      if (i === legIndex) {
        return {
          ...leg,
          place,
          alternatives,
          transport: leg.transport
            ? { ...leg.transport, to: place.location }
            : null,
        }
      }
      if (i === legIndex + 1 && leg.transport) {
        return { ...leg, transport: { ...leg.transport, from: place.location } }
      }
      return leg
    }),
  )
}

/** 保存交通时长编辑：时长更新，基准速度按当前距离与新时长重算。 */
export function withTransportDuration(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
  durationMinutes: number,
): Trip {
  return mapDay(trip, dayKey, (legs) =>
    legs.map((leg, i) =>
      i === legIndex
        ? { ...leg, transport: transportWithDuration(leg, durationMinutes) }
        : leg,
    ),
  )
}

/**
 * 插入新地点（需求 8.1"临时发现新地点"）：
 * - afterLegIndex 为 null：追加到当天末尾；否则插到该段之后
 * - 有前序地点时自动生成默认交通（固定 30 分钟，坐标相同故基准速度为 null，
 *   用户改坐标/时长后基准在保存时重算）
 * - 下一段交通的 from 快照同步为新地点坐标（时长与基准不变）
 * - 后续 slot 不自动平移，产生的时间冲突由警告层显式呈现
 */
export function withPlaceInserted(
  trip: Trip,
  dayKey: DateISO,
  afterLegIndex: number | null,
): Trip {
  const day = trip.days.find((entry) => entry.date === dayKey)
  if (!day) return trip
  const legs = day.legs
  const prevLeg =
    afterLegIndex === null
      ? legs.length > 0
        ? legs[legs.length - 1]
        : null
      : (legs[afterLegIndex] ?? null)
  const window = getTripDayWindow(trip, dayKey)
  const prevEnd = prevLeg ? legEnd(prevLeg) : window.startUtc
  const location = prevLeg ? prevLeg.place.location : { lat: 0, lng: 0 }
  const start = addMinutes(prevEnd, prevLeg ? DEFAULT_INSERT_TRANSPORT_MINUTES : 0)
  const transport: TransportSlot | null = prevLeg
    ? {
        start: prevEnd,
        durationMinutes: DEFAULT_INSERT_TRANSPORT_MINUTES,
        from: prevLeg.place.location,
        to: location,
        baseSpeedKmh: impliedSpeedKmh(
          haversineKm(prevLeg.place.location, location),
          DEFAULT_INSERT_TRANSPORT_MINUTES,
        ),
      }
    : null
  const newLeg: Leg = {
    transport,
    place: {
      id: `p-${Date.now().toString(36)}`,
      name: '新地点',
      location,
      priority: DEFAULT_INSERT_PRIORITY,
      start,
      durationMinutes: DEFAULT_INSERT_STAY_MINUTES,
      open: null,
      close: null,
      minStayMinutes: null,
      maxStayMinutes: null,
      fixedStart: null,
    },
    alternatives: [],
  }
  return mapDay(trip, dayKey, (current) => {
    const next = [...current]
    const insertAt = afterLegIndex === null ? current.length : afterLegIndex + 1
    next.splice(insertAt, 0, newLeg)
    const following = next[insertAt + 1]
    if (following?.transport) {
      next[insertAt + 1] = {
        ...following,
        transport: { ...following.transport, from: location },
      }
    }
    return next
  })
}

/**
 * 删除地点：
 * - 移除该段；若删除的是首段，新首段的交通置空（没有前序地点）
 * - 其余各段的 from 快照顺延为新的前序地点坐标（时长与基准不变）
 */
export function withPlaceDeleted(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
): Trip {
  return mapDay(trip, dayKey, (legs) => {
    if (legIndex < 0 || legIndex >= legs.length) return legs
    const next = legs.filter((_, i) => i !== legIndex)
    if (next.length > 0 && next[0].transport) {
      next[0] = { ...next[0], transport: null }
    }
    for (let i = 1; i < next.length; i++) {
      const leg = next[i]
      if (leg.transport) {
        next[i] = {
          ...leg,
          transport: { ...leg.transport, from: next[i - 1].place.location },
        }
      }
    }
    return next
  })
}

/**
 * 采纳重排草案：用草案段落替换目标日期 fromLegIndex 之后的行程。
 * 草案由 replan 引擎生成，前缀保持原引用不变（需求 1.2：最终由用户决定）。
 */
export function withDraftAdopted(trip: Trip, draft: ReplanDraft): Trip {
  return mapDay(trip, draft.day, (legs) => [
    ...legs.slice(0, draft.fromLegIndex),
    ...draft.legs,
  ])
}
