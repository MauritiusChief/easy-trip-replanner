import type { Trip } from '../domain/types'
import { validateTrip } from './validate'

/** 将当前行程格式化为可移植、可读的 JSON 文件内容。 */
export function exportTripJson(trip: Trip): string {
  return JSON.stringify(trip, null, 2)
}

/** 按行程名称生成跨平台可用的 JSON 文件名。 */
export function getTripExportFilename(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.json$/i, '')
  return `${base || 'easy-trip'}.json`
}

/** 解析并校验用户选择的 JSON；失败时不修改当前行程。 */
export function importTripJson(text: string): Trip | null {
  try {
    return validateTrip(JSON.parse(text))
  } catch {
    return null
  }
}
