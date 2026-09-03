import { useEffect, useState } from 'react'
import { NOW_TICK_MS } from '../domain/config'
import type { EpochMs } from '../domain/types'

/**
 * 周期性刷新的"当前时间"。
 *
 * @param offsetMs 调试时间偏移（毫秒），返回值 = 真实时间 + offsetMs。
 *   改变 offsetMs 会立即反映到返回值，无需等待下一次 tick。
 *
 * 实现说明：状态里只存真实时间（setInterval 回调里更新，避免在 effect
 * 中同步 setState 触发级联渲染），偏移在渲染期追加。
 */
export function useNow(offsetMs = 0): EpochMs {
  const [realNow, setRealNow] = useState<EpochMs>(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setRealNow(Date.now()), NOW_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return realNow + offsetMs
}
