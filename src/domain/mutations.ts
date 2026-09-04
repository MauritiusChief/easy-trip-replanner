import { MS_PER_MINUTE } from './config'
import { getTripDayWindow } from './current'
import { haversineKm, impliedSpeedKmh } from './geo'
import { addMinutes, listDayKeys } from './time'
import type {
  AlternativePlace,
  DateISO,
  DayPlan,
  EpochMs,
  Leg,
  MinuteOfDay,
  PlaceSlot,
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

/** 行程级设置（"行程设置"表单的保存输入）。 */
export interface TripSettings {
  name: string
  timezone: string
  startDate: DateISO
  endDate: DateISO
  dailyStart: MinuteOfDay
  dailyEnd: MinuteOfDay
}

/**
 * 保存行程级设置：
 * - 名称、时区、每日窗口直接覆盖。时区改变不换算既有时刻：
 *   所有 slot 存的是 UTC 绝对时刻，墙上时钟显示随之改变
 * - 日期范围变化时把 days 对齐到 [startDate, endDate]：
 *   范围内缺失的日期补空日，范围外的日期连同其 dayOverrides 一并删除
 *   （缩小范围是破坏性操作，由表单层负责向用户确认）
 */
export function withTripSettingsSaved(trip: Trip, settings: TripSettings): Trip {
  const existing = new Map(trip.days.map((day) => [day.date, day]))
  const days: DayPlan[] = listDayKeys(settings.startDate, settings.endDate).map(
    (key) => existing.get(key) ?? { date: key, legs: [], alternatives: [] },
  )
  const overrides: Trip['dayOverrides'] = {}
  for (const [key, value] of Object.entries(trip.dayOverrides)) {
    if (key >= settings.startDate && key <= settings.endDate) {
      overrides[key] = value
    }
  }
  return { ...trip, ...settings, days, dayOverrides: overrides }
}

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

/** 对某一天的 DayPlan（含备选库）做不可变映射，其余日期保持引用不变。 */
function mapDayFull(
  trip: Trip,
  dayKey: DateISO,
  edit: (day: DayPlan) => DayPlan,
): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => (day.date === dayKey ? edit(day) : day)),
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
 * - 更新地点字段（备选地点在日级库单独编辑，见 withAlternativeSaved）
 * - 自身到达交通的结束时刻贴紧地点新开始时间，并同步其 to 坐标
 * - 下一段交通的 from 快照指向新坐标
 *   （时长与基准速度不动，坐标变化导致的速度偏差由警告层提示）
 */
export function withPlaceSaved(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
  place: PlaceSlot,
): Trip {
  return mapDay(trip, dayKey, (legs) =>
    legs.map((leg, i) => {
      if (i === legIndex) {
        return {
          ...leg,
          place,
          transport: leg.transport
            ? {
                ...leg.transport,
                start: place.start - leg.transport.durationMinutes * MS_PER_MINUTE,
                to: place.location,
              }
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
 * 为已有地点补建到达交通：仅非首段且当前缺少交通时生效。
 * 默认交通时长为 30 分钟，结束时刻贴紧目标地点开始时间。
 */
export function withTransportInserted(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
): Trip {
  return mapDay(trip, dayKey, (legs) => {
    const target = legs[legIndex]
    const previous = legIndex > 0 ? legs[legIndex - 1] : undefined
    if (!target || !previous || target.transport) return legs
    const durationMinutes = DEFAULT_INSERT_TRANSPORT_MINUTES
    const transport: TransportSlot = {
      start: target.place.start - durationMinutes * MS_PER_MINUTE,
      durationMinutes,
      from: previous.place.location,
      to: target.place.location,
      baseSpeedKmh: impliedSpeedKmh(
        haversineKm(previous.place.location, target.place.location),
        durationMinutes,
      ),
    }
    return legs.map((leg, index) => (index === legIndex ? { ...leg, transport } : leg))
  })
}

/** 删除一个地点的到达交通；地点及后续行程均保持不动。 */
export function withTransportDeleted(trip: Trip, dayKey: DateISO, legIndex: number): Trip {
  return mapDay(trip, dayKey, (legs) =>
    legs.map((leg, index) =>
      index === legIndex && leg.transport ? { ...leg, transport: null } : leg,
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
 * - 备选库中链接到该地点的条目保留，linkedPlaceId 置 null（"未连接"）
 */
export function withPlaceDeleted(
  trip: Trip,
  dayKey: DateISO,
  legIndex: number,
): Trip {
  return mapDayFull(trip, dayKey, (day) => {
    if (legIndex < 0 || legIndex >= day.legs.length) return day
    const removedId = day.legs[legIndex].place.id
    const legs = day.legs.filter((_, i) => i !== legIndex)
    if (legs.length > 0 && legs[0].transport) {
      legs[0] = { ...legs[0], transport: null }
    }
    for (let i = 1; i < legs.length; i++) {
      const leg = legs[i]
      if (leg.transport) {
        legs[i] = {
          ...leg,
          transport: { ...leg.transport, from: legs[i - 1].place.location },
        }
      }
    }
    const alternatives = day.alternatives.map((alternative) =>
      alternative.linkedPlaceId === removedId
        ? { ...alternative, linkedPlaceId: null }
        : alternative,
    )
    return { ...day, legs, alternatives }
  })
}

/**
 * 保存备选地点（需求 7）：按 id upsert，新条目追加到库末尾。
 * linkedPlaceId 允许 null（未连接）或指向当日任意计划地点。
 */
export function withAlternativeSaved(
  trip: Trip,
  dayKey: DateISO,
  alternative: AlternativePlace,
): Trip {
  return mapDayFull(trip, dayKey, (day) => ({
    ...day,
    alternatives: day.alternatives.some((entry) => entry.id === alternative.id)
      ? day.alternatives.map((entry) =>
          entry.id === alternative.id ? alternative : entry,
        )
      : [...day.alternatives, alternative],
  }))
}

/** 删除备选库条目。 */
export function withAlternativeDeleted(
  trip: Trip,
  dayKey: DateISO,
  altId: string,
): Trip {
  return mapDayFull(trip, dayKey, (day) => ({
    ...day,
    alternatives: day.alternatives.filter((entry) => entry.id !== altId),
  }))
}
