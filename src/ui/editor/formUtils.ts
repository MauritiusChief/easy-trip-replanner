import type { MinuteOfDay } from '../../domain/types'

/**
 * 编辑表单的输入解析工具。
 * 约定沿用 validate.ts：null 表示"留空 = 无约束"，undefined 表示"非法输入"。
 */

/** 'HH:mm' 文本 → 当日分钟数；格式非法或超范围返回 null。 */
export function parseTimeInput(value: string): MinuteOfDay | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * 可选的分钟数输入（停留时长/交通时长）。
 * 空字符串 → null（无约束）；非数字或负数 → undefined（非法）。
 */
export function parseOptionalMinutes(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.round(parsed)
}

/** 坐标输入：必须在 [min, max] 内；非法返回 undefined。 */
export function parseCoordinate(value: string, min: number, max: number): number | undefined {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

/** 优先级输入：正整数；非法返回 undefined。 */
export function parsePriority(value: string): number | undefined {
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < 1) return undefined
  return parsed
}
