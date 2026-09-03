import { STORAGE_KEY } from '../domain/config'
import { createEmptyTrip } from './emptyTrip'
import type { Trip } from '../domain/types'
import { validateTrip } from './validate'

/**
 * localStorage 数据访问层（数据仅存浏览器，无导入导出）。
 * 应用不内置示例行程：无存档或数据无效时回退到空行程，
 * 用户从"行程设置"开始指定自己的旅行计划。
 */

export interface LoadedTrip {
  trip: Trip
  /** storage：来自本地存储；empty：新建的空行程（首次打开或数据无效）。 */
  source: 'storage' | 'empty'
  /** 非 null 时为需要展示给用户的重置/降级提示。 */
  resetReason: string | null
}

/** 数据无效时的统一回退：重置为空行程并携带提示文案。 */
function resetTrip(reason: string): LoadedTrip {
  return { trip: createEmptyTrip(), source: 'empty', resetReason: reason }
}

/**
 * 读取行程：
 * 1. localStorage 不可用（隐私模式等）→ 空行程 + "不会被保存"提示
 * 2. 无存档 → 空行程（首次初始化，无提示）
 * 3. 存档解析或校验失败 → 空行程 + 重置提示
 *    （数据已不可恢复，自动重置比阻塞在错误页更符合工具定位）
 */
export function loadTrip(): LoadedTrip {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return {
      trip: createEmptyTrip(),
      source: 'empty',
      resetReason: '无法访问本地存储，本次的更改可能不会被保存',
    }
  }
  if (raw === null) {
    return { trip: createEmptyTrip(), source: 'empty', resetReason: null }
  }
  try {
    const trip = validateTrip(JSON.parse(raw))
    if (trip) return { trip, source: 'storage', resetReason: null }
  } catch {
    return resetTrip('本地行程数据无效，已重置为空行程')
  }
  return resetTrip('本地行程数据无效，已重置为空行程')
}

/**
 * 保存行程，返回是否成功。
 * 失败（配额、隐私模式）由调用方决定如何提示，不在此处弹出任何 UI。
 */
export function saveTrip(trip: Trip): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trip))
    return true
  } catch {
    return false
  }
}
