import { EARTH_RADIUS_KM } from './config'
import type { GeoPoint } from './types'

/**
 * 两点间的球面大圆距离（haversine 公式），单位公里。
 * 不接入地图 API（需求 10.1），直线距离是绕路检测与速度计算的唯一几何依据。
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
 * 由距离与交通时长计算"隐含速度"（km/h，保留 1 位小数）。
 *
 * 语义约定（需求 4.3/4.4）：时长是输入、速度是派生值——这是本应用唯一的
 * 速度计算方向。用户设定/保持交通时长，距离变化（前序地点改变）时系统用
 * 本函数重算隐含速度，再与基准速度比较以触发速度异常警告；
 * 交通时长本身永远不由速度反推。
 *
 * 返回 null 表示无法计算（时长非正，或距离小于 50 米——同建筑群内的
 * 短挪动没有参考价值）。
 */
export function impliedSpeedKmh(
  distanceKm: number,
  durationMinutes: number,
): number | null {
  if (durationMinutes <= 0 || !Number.isFinite(distanceKm)) return null
  if (distanceKm < 0.05) return null
  return Math.round((distanceKm / (durationMinutes / 60)) * 10) / 10
}
