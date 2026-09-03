import {
  DEFAULT_DAILY_END,
  DEFAULT_DAILY_START,
  SCHEMA_VERSION,
} from '../domain/config'
import { todayKeyInZone } from '../domain/time'
import type { Trip } from '../domain/types'

/**
 * 空行程工厂：首次打开或本地数据无效时的起点。
 * 应用不内置任何示例行程，用户从零指定自己的旅行计划：
 * 名称、时区、日期范围与每日窗口随后通过"行程设置"修改。
 */

/** 猜测设备所在时区作为默认值；无法确定时回落 UTC（仍是合法 IANA 名称）。 */
function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 构建空行程：旅行时区的"今天"单日、无任何行程段与备选。 */
export function createEmptyTrip(): Trip {
  const timezone = guessTimeZone()
  const today = todayKeyInZone(timezone)
  return {
    schemaVersion: SCHEMA_VERSION,
    name: '我的旅行',
    timezone,
    startDate: today,
    endDate: today,
    dailyStart: DEFAULT_DAILY_START,
    dailyEnd: DEFAULT_DAILY_END,
    dayOverrides: {},
    days: [{ date: today, legs: [], alternatives: [] }],
  }
}
