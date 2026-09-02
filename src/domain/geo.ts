import { EARTH_RADIUS_KM, MIN_TRANSPORT_MINUTES, TIME_STEP_MINUTES } from './config'
import type { GeoPoint } from './types'

/**
 * 两点间的球面大圆距离（haversine 公式），单位公里。
 * 不接入地图 API（需求 10.1），直线距离是绕路检测与速度估算的唯一几何依据。
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s))
}

/**
 * 由距离与用户设定的交通时长反推"隐含速度"（km/h，保留 1 位小数）。
 * 返回 null 表示无法推断（时长非正，或距离小于 50 米——同建筑群内的短挪动没有参考价值）。
 */
export function impliedSpeedKmh(
  distanceKm: number,
  durationMinutes: number,
): number | null {
  if (durationMinutes <= 0 || !Number.isFinite(distanceKm)) return null
  if (distanceKm < 0.05) return null
  return Math.round((distanceKm / (durationMinutes / 60)) * 10) / 10
}

/**
 * 按给定速度估算交通时长（分钟）：
 * 向上取整到 5 分钟网格，并保证不低于 MIN_TRANSPORT_MINUTES。
 * 用于重排时对新路线的交通时长给出草稿值。
 */
export function estimateTransportMinutes(
  distanceKm: number,
  speedKmh: number,
): number {
  const rawMinutes = (distanceKm / speedKmh) * 60
  return Math.max(
    MIN_TRANSPORT_MINUTES,
    Math.ceil(rawMinutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES,
  )
}
