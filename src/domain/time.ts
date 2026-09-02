import { MS_PER_MINUTE, TIME_STEP_MINUTES } from './config'
import type { DateISO, EpochMs, MinuteOfDay } from './types'

/** 某一 UTC 时刻在指定时区下拆解出的年月日时分（墙上时钟读数）。 */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

// 以下两个缓存避免每次格式化都重建 Intl.DateTimeFormat（构造开销较大）。
// 解析用 en-US（保证数字部分是拉丁数字，便于 Number() 提取）；
// 展示用 zh-CN（输出形如 "14:05" 的中文环境格式）。
const partsCache = new Map<string, Intl.DateTimeFormat>()
const timeFormatCache = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    partsCache.set(timeZone, formatter)
  }
  return formatter
}

/**
 * 判断是否为有效的 IANA 时区名（如 Asia/Tokyo）。
 * 用于数据校验：无效时区会导致后续所有换算抛错，必须提前拦截。
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * 把 UTC 时刻换算为指定时区下的墙上时钟读数。
 * 是所有"展示层时区换算"的底层函数。
 */
export function getZonedParts(epochMs: EpochMs, timeZone: string): ZonedParts {
  const values: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

/**
 * 指定时区在某一 UTC 时刻的偏移量（毫秒，东正西负）。
 * 由"该时刻的墙上读数按 UTC 解释后减去真实 UTC"反推得出。
 */
export function getTimeZoneOffsetMs(epochMs: EpochMs, timeZone: string): number {
  const parts = getZonedParts(epochMs, timeZone)
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    epochMs
  )
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** UTC 时刻 → 旅行时区下的日期键 'YYYY-MM-DD'。 */
export function getZonedDayKey(epochMs: EpochMs, timeZone: string): DateISO {
  const parts = getZonedParts(epochMs, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/** UTC 时刻 → 旅行时区下的当日分钟数（0–1439）。 */
export function getZonedMinuteOfDay(epochMs: EpochMs, timeZone: string): MinuteOfDay {
  const parts = getZonedParts(epochMs, timeZone)
  return parts.hour * 60 + parts.minute
}

/**
 * "旅行时区的某日某时刻" → UTC 时刻。
 *
 * 算法（两次偏移法，不依赖任何库）：
 * 1. 先假定该墙上时间就是 UTC，得到猜测值 guess
 * 2. 用 guess 处的时区偏移修正一次得到 epoch
 * 3. 再用 epoch 处的偏移复核，不一致（DST 切换日）则用第二次偏移再修正
 *
 * 边界策略（阶段 0 决策）：
 * - 不存在的本地时间（春季拨快）会被平移到过渡后的确定时刻
 * - 歧义的本地时间（秋季拨慢）取其中确定的一个结果
 * 旅行场景窗口为白天时段，受 DST 边界影响极小，可接受。
 */
export function dayKeyToUtcEpoch(
  dayKey: DateISO,
  minuteOfDay: MinuteOfDay,
  timeZone: string,
): EpochMs {
  const [year, month, day] = dayKey.split('-').map(Number)
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const firstOffset = getTimeZoneOffsetMs(guess, timeZone)
  let epoch = guess - firstOffset
  const secondOffset = getTimeZoneOffsetMs(epoch, timeZone)
  if (secondOffset !== firstOffset) epoch = guess - secondOffset
  return epoch
}

/** 当前真实时间在指定时区下的日期键。 */
export function todayKeyInZone(timeZone: string): DateISO {
  return getZonedDayKey(Date.now(), timeZone)
}

/**
 * 日期键加/减若干天。
 * 全程用 UTC 日期算术，避免夏令时导致的日期跳变。
 */
export function addDaysToDayKey(dayKey: DateISO, days: number): DateISO {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** 枚举 [startDate, endDate] 闭区间内的所有日期键（ISO 字符串可直接比较）。 */
export function listDayKeys(startDate: DateISO, endDate: DateISO): DateISO[] {
  const keys: DateISO[] = []
  for (let key = startDate; key <= endDate; key = addDaysToDayKey(key, 1)) {
    keys.push(key)
  }
  return keys
}

/** 日期键 → 中文星期标签（如 '周三'）。星期由日历日期决定，与时区无关。 */
export function dayKeyToWeekdayLabel(dayKey: DateISO): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  return WEEKDAYS_ZH[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

/** 日期键 → 短标签（如 '9月2日'）。 */
export function dayKeyToLabel(dayKey: DateISO): string {
  const [, month, day] = dayKey.split('-').map(Number)
  return `${month}月${day}日`
}

/** 当日分钟数 → 'HH:mm'。 */
export function formatMinuteOfDay(minute: MinuteOfDay): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}

/** UTC 时刻 → 指定时区下的 'HH:mm' 显示文本。 */
export function formatZonedTime(epochMs: EpochMs, timeZone: string): string {
  let formatter = timeFormatCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    })
    timeFormatCache.set(timeZone, formatter)
  }
  return formatter.format(new Date(epochMs))
}

/** 某日的可规划窗口 [窗口开始, 窗口结束]，以 UTC 毫秒表示。 */
export function getDayWindowUtc(
  dayKey: DateISO,
  startMinute: MinuteOfDay,
  endMinute: MinuteOfDay,
  timeZone: string,
): { startUtc: EpochMs; endUtc: EpochMs } {
  return {
    startUtc: dayKeyToUtcEpoch(dayKey, startMinute, timeZone),
    endUtc: dayKeyToUtcEpoch(dayKey, endMinute, timeZone),
  }
}

/** 把 UTC 时刻取整到最近的 5 分钟网格点（默认步长）。 */
export function roundEpochToStep(
  epochMs: EpochMs,
  stepMinutes: number = TIME_STEP_MINUTES,
): EpochMs {
  const step = stepMinutes * MS_PER_MINUTE
  return Math.round(epochMs / step) * step
}

/** 把分钟数取整到最近的 5 分钟倍数（默认步长）。 */
export function roundMinutesToStep(
  minutes: number,
  stepMinutes: number = TIME_STEP_MINUTES,
): number {
  return Math.round(minutes / stepMinutes) * stepMinutes
}

/** UTC 时刻加上若干分钟（可为负）。 */
export function addMinutes(epochMs: EpochMs, minutes: number): EpochMs {
  return epochMs + minutes * MS_PER_MINUTE
}

/** 两个 UTC 时刻相差的分钟数（a - b，可为负）。 */
export function epochDiffMinutes(a: EpochMs, b: EpochMs): number {
  return (a - b) / MS_PER_MINUTE
}
