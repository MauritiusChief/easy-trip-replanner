import {
  DETOUR_EXTRA_KM,
  DETOUR_EXTRA_RATIO,
  MS_PER_MINUTE,
  SPEED_ANOMALY_RATIO,
} from './config'
import { getTripDayWindow } from './current'
import { haversineKm, impliedSpeedKmh } from './geo'
import { formatMinuteOfDay, formatZonedTime, getZonedMinuteOfDay } from './time'
import type { DayPlan, EpochMs, Leg, PlanWarning, Trip } from './types'

/**
 * 计划校验层（需求 8.2）：对编辑后的计划做静态检查，
 * 产出显式的警告列表供界面展示——只提示，不隐式修改计划。
 *
 * 覆盖：固定锚点冲突、最短停留、开放时间、每日窗口、slot 重叠、
 * 交通缺失、速度异常（重算隐含速度 vs 基准，需求 4.4）、绕路提示（需求 6）。
 */

/** 段落的结束时刻（停留结束）。 */
function legEnd(leg: Leg): EpochMs {
  return leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
}

/**
 * 检查某一天的完整计划，返回按行程段顺序排列的警告。
 * 纯函数：随 trip/day 引用变化由界面 useMemo 缓存。
 */
export function collectDayWarnings(trip: Trip, day: DayPlan): PlanWarning[] {
  const warnings: PlanWarning[] = []
  const tz = trip.timezone
  const { startUtc, endUtc } = getTripDayWindow(trip, day.date)
  const windowLabel = `${formatMinuteOfDay(
    trip.dayOverrides[day.date]?.start ?? trip.dailyStart,
  )}–${formatMinuteOfDay(trip.dayOverrides[day.date]?.end ?? trip.dailyEnd)}`
  const add = (
    kind: PlanWarning['kind'],
    legIndex: number,
    message: string,
  ) => {
    warnings.push({ kind, day: day.date, legIndex, message })
  }

  day.legs.forEach((leg, i) => {
    const place = leg.place
    const placeEnd = legEnd(leg)
    const name = `「${place.name}」`

    if (place.fixedStart !== null && getZonedMinuteOfDay(place.start, tz) !== place.fixedStart) {
      add(
        'fixed-conflict',
        i,
        `${name}固定 ${formatMinuteOfDay(place.fixedStart)} 开始，但当前开始于 ${formatZonedTime(place.start, tz)}`,
      )
    }

    if (place.minStayMinutes !== null && place.durationMinutes < place.minStayMinutes) {
      add(
        'min-stay',
        i,
        `${name}停留 ${place.durationMinutes} 分钟，低于最短 ${place.minStayMinutes} 分钟`,
      )
    }

    const startMinute = getZonedMinuteOfDay(place.start, tz)
    const endMinute = getZonedMinuteOfDay(placeEnd, tz)
    if (place.open !== null && startMinute < place.open) {
      add(
        'open-hours',
        i,
        `${name} ${formatMinuteOfDay(place.open)} 才开放，但计划 ${formatMinuteOfDay(startMinute)} 到达`,
      )
    }
    if (place.close !== null && endMinute > place.close) {
      add(
        'open-hours',
        i,
        `${name} ${formatMinuteOfDay(place.close)} 关门，但计划 ${formatMinuteOfDay(endMinute)} 才离开`,
      )
    }

    if (place.start < startUtc || placeEnd > endUtc) {
      add('out-of-window', i, `${name}超出当日窗口（${windowLabel}）`)
    }

    const prev = i > 0 ? day.legs[i - 1] : null
    if (leg.transport) {
      const transportEnd = leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
      if (leg.transport.start < startUtc || transportEnd > endUtc) {
        add('out-of-window', i, `前往${name}的交通超出当日窗口（${windowLabel}）`)
      }
      if (place.start < transportEnd) {
        add('overlap', i, `前往${name}的交通与停留时间重叠`)
      }
      if (prev && leg.transport.start < legEnd(prev)) {
        add(
          'overlap',
          i,
          `「${prev.place.name}」的停留与前往${name}的交通时间重叠`,
        )
      }
      if (leg.transport.baseSpeedKmh !== null) {
        const base = leg.transport.baseSpeedKmh
        const current = impliedSpeedKmh(
          haversineKm(leg.transport.from, place.location),
          leg.transport.durationMinutes,
        )
        if (current !== null && Math.abs(current - base) / base > SPEED_ANOMALY_RATIO) {
          add(
            'speed-anomaly',
            i,
            `前往${name}按当前时长隐含速度 ${current} km/h，与基准 ${base} km/h 偏差较大，建议核对交通时长`,
          )
        }
      }
    } else if (i > 0) {
      add('missing-transport', i, `${name}缺少到达交通`)
      if (prev && place.start < legEnd(prev)) {
        add('overlap', i, `「${prev.place.name}」的停留与${name}的时间重叠`)
      }
    }
  })

  // 绕路提示（需求 6.1）：相邻三点 A→B→C，若"路径距离"比"直达距离"
  // 多出至少 DETOUR_EXTRA_RATIO 比例且不少于 DETOUR_EXTRA_KM 公里，
  // 提示 B 的当前位置可能绕路。只提示，不自动调整。
  for (let i = 1; i + 1 < day.legs.length; i++) {
    const a = day.legs[i - 1].place.location
    const b = day.legs[i].place.location
    const c = day.legs[i + 1].place.location
    const direct = haversineKm(a, c)
    if (direct < 0.05) continue
    const path = haversineKm(a, b) + haversineKm(b, c)
    const extraKm = path - direct
    if (extraKm >= DETOUR_EXTRA_KM && extraKm / direct >= DETOUR_EXTRA_RATIO) {
      add(
        'detour',
        i,
        `「${day.legs[i].place.name}」可能产生绕路：经它中转比直达多约 ${extraKm.toFixed(1)} 公里`,
      )
    }
  }

  return warnings
}

/** 汇总整个行程的警告（按天分组顺序拼接），供全局提示使用。 */
export function collectTripWarnings(trip: Trip): PlanWarning[] {
  return trip.days.flatMap((day) => collectDayWarnings(trip, day))
}
