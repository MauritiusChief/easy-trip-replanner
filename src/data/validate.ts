import { SCHEMA_VERSION } from '../domain/config'
import { isValidTimeZone } from '../domain/time'
import type {
  AlternativePlace,
  DayPlan,
  DayWindowOverride,
  DateISO,
  GeoPoint,
  Leg,
  MinuteOfDay,
  PlaceSlot,
  TransportSlot,
  Trip,
} from '../domain/types'

/**
 * localStorage 恢复数据的结构校验。
 *
 * 总体策略：
 * - 结构性问题（缺字段、类型错误、版本不符）→ 整条拒绝，返回 null，
 *   由 storage 层回退到示例行程并提示用户
 * - 字段级缺失：可选字段缺省视为 null（无约束），不做修补
 * - 校验只保证"能安全渲染"，语义冲突（时间重叠等）留给阶段 2 的编辑校验层
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 日期键格式检查（不校历法合法性，历法错误会在换算时暴露）。 */
function isDateIso(value: unknown): value is DateISO {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isMinuteOfDay(value: unknown): value is MinuteOfDay {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440
  )
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 可选分钟字段：缺省 → null（无约束）；存在但非法 → undefined（整条拒绝的信号）。 */
function optionalMinute(value: unknown): MinuteOfDay | null | undefined {
  if (value === undefined || value === null) return null
  return isMinuteOfDay(value) ? value : undefined
}

/** 可选正数字段（停留时长）：缺省 → null；存在但非法 → undefined。 */
function optionalStay(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  return isPositiveNumber(value) ? value : undefined
}

function validateLocation(value: unknown): GeoPoint | null {
  if (!isRecord(value)) return null
  if (typeof value.lat !== 'number' || !Number.isFinite(value.lat)) return null
  if (typeof value.lng !== 'number' || !Number.isFinite(value.lng)) return null
  return { lat: value.lat, lng: value.lng }
}

/** 地点除日程外的基础字段（PlaceSlot 与 AlternativePlace 共用）。 */
type PlaceBase = Omit<PlaceSlot, 'start' | 'durationMinutes'>

function validatePlaceBase(value: unknown): PlaceBase | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.name !== 'string' || value.name.length === 0) return null
  const location = validateLocation(value.location)
  if (!location) return null
  if (typeof value.priority !== 'number' || !Number.isInteger(value.priority)) return null
  const open = optionalMinute(value.open)
  if (open === undefined) return null
  const close = optionalMinute(value.close)
  if (close === undefined) return null
  const minStayMinutes = optionalStay(value.minStayMinutes)
  if (minStayMinutes === undefined) return null
  const maxStayMinutes = optionalStay(value.maxStayMinutes)
  if (maxStayMinutes === undefined) return null
  const fixedStart = optionalMinute(value.fixedStart)
  if (fixedStart === undefined) return null
  return {
    id: value.id,
    name: value.name,
    location,
    priority: value.priority,
    open,
    close,
    minStayMinutes,
    maxStayMinutes,
    fixedStart,
  }
}

function validatePlaceSlot(value: unknown): PlaceSlot | null {
  const base = validatePlaceBase(value)
  if (!base || !isRecord(value)) return null
  if (typeof value.start !== 'number' || !Number.isFinite(value.start)) return null
  if (!isPositiveNumber(value.durationMinutes)) return null
  return { ...base, start: value.start, durationMinutes: value.durationMinutes }
}

function validateTransport(value: unknown): TransportSlot | null {
  if (!isRecord(value)) return null
  if (typeof value.start !== 'number' || !Number.isFinite(value.start)) return null
  if (!isPositiveNumber(value.durationMinutes)) return null
  const from = validateLocation(value.from)
  const to = validateLocation(value.to)
  if (!from || !to) return null
  const rawSpeed = value.baseSpeedKmh
  // 速度字段较宽容：非法值一律降级为 null（仅影响展示），不让整条数据作废
  const baseSpeedKmh =
    rawSpeed === null || rawSpeed === undefined
      ? null
      : isPositiveNumber(rawSpeed)
        ? rawSpeed
        : null
  return { start: value.start, durationMinutes: value.durationMinutes, from, to, baseSpeedKmh }
}

function validateLeg(value: unknown): Leg | null {
  if (!isRecord(value)) return null
  const place = validatePlaceSlot(value.place)
  if (!place) return null
  let transport: TransportSlot | null = null
  if (value.transport !== null && value.transport !== undefined) {
    transport = validateTransport(value.transport)
    if (!transport) return null
  }
  return { transport, place }
}

/**
 * 备选地点（日级库条目）：地点基础字段 + 独立的计划停留时长 + 链接字段。
 * linkedPlaceId 允许 null（未连接）或任意非空字符串（允许悬空，
 * 悬空条目在界面显示为"未连接"，不做跨引用拒绝）。
 */
function validateAlternative(value: unknown): AlternativePlace | null {
  const base = validatePlaceBase(value)
  if (!base || !isRecord(value)) return null
  if (!isPositiveNumber(value.durationMinutes)) return null
  let linkedPlaceId: string | null = null
  if (value.linkedPlaceId !== undefined && value.linkedPlaceId !== null) {
    if (typeof value.linkedPlaceId !== 'string' || value.linkedPlaceId.length === 0) {
      return null
    }
    linkedPlaceId = value.linkedPlaceId
  }
  return { ...base, durationMinutes: value.durationMinutes, linkedPlaceId }
}

function validateDay(value: unknown): DayPlan | null {
  if (!isRecord(value)) return null
  if (!isDateIso(value.date)) return null
  if (!Array.isArray(value.legs)) return null
  const legs: Leg[] = []
  for (const raw of value.legs) {
    const leg = validateLeg(raw)
    if (!leg) return null
    legs.push(leg)
  }
  const alternatives: AlternativePlace[] = []
  if (value.alternatives !== null && value.alternatives !== undefined) {
    if (!Array.isArray(value.alternatives)) return null
    for (const raw of value.alternatives) {
      const alternative = validateAlternative(raw)
      if (!alternative) return null
      alternatives.push(alternative)
    }
  }
  return { date: value.date, legs, alternatives }
}

/** 未知结构的 dayOverrides：只收集合法条目，其余静默丢弃（覆盖缺失会回落到统一窗口）。 */
function validateOverrides(value: unknown): Record<DateISO, DayWindowOverride> {
  const overrides: Record<DateISO, DayWindowOverride> = {}
  if (!isRecord(value)) return overrides
  for (const [key, entry] of Object.entries(value)) {
    if (!isDateIso(key) || !isRecord(entry)) continue
    const start =
      entry.start === undefined || entry.start === null
        ? undefined
        : isMinuteOfDay(entry.start)
          ? entry.start
          : undefined
    const end =
      entry.end === undefined || entry.end === null
        ? undefined
        : isMinuteOfDay(entry.end)
          ? entry.end
          : undefined
    overrides[key] = { start, end }
  }
  return overrides
}

/**
 * 校验并还原 Trip。
 * 返回 null 表示数据不可用，调用方应回退到示例行程（见 storage.loadTrip）。
 */
export function validateTrip(raw: unknown): Trip | null {
  if (!isRecord(raw)) return null
  if (raw.schemaVersion !== SCHEMA_VERSION) return null
  if (typeof raw.name !== 'string' || raw.name.length === 0) return null
  if (typeof raw.timezone !== 'string' || !isValidTimeZone(raw.timezone)) return null
  if (!isDateIso(raw.startDate) || !isDateIso(raw.endDate)) return null
  if (raw.startDate > raw.endDate) return null
  if (!isMinuteOfDay(raw.dailyStart) || !isMinuteOfDay(raw.dailyEnd)) return null
  if (raw.dailyStart >= raw.dailyEnd) return null
  if (!Array.isArray(raw.days)) return null
  const days: DayPlan[] = []
  for (const rawDay of raw.days) {
    const day = validateDay(rawDay)
    if (!day) return null
    days.push(day)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    name: raw.name,
    timezone: raw.timezone,
    startDate: raw.startDate,
    endDate: raw.endDate,
    dailyStart: raw.dailyStart,
    dailyEnd: raw.dailyEnd,
    dayOverrides: validateOverrides(raw.dayOverrides),
    days,
  }
}
