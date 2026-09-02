import { useEffect, useState } from 'react'
import { MS_PER_MINUTE } from '../domain/config'
import { formatZonedTime } from '../domain/time'
import type { EpochMs } from '../domain/types'

interface DebugTimePanelProps {
  /** 是否展开；收起时不渲染任何内容（热键监听在 App 层，关闭后仍可再次唤起）。 */
  open: boolean
  /** 当前生效的调试偏移（毫秒），虚构时间 = 真实时间 + offsetMs。 */
  offsetMs: number
  /** 虚构后的当前时间，由 App 的 useNow 传入，面板自身不在渲染期取时钟。 */
  fakeNow: EpochMs
  /** 旅行时区，用于按应用视角显示虚构时间。 */
  timeZone: string
  onChangeOffset: (offsetMs: number) => void
  onClose: () => void
}

/** 快捷偏移按钮：相对真实时间整体平移，单位覆盖分钟/小时/天。 */
const OFFSET_STEPS: Array<{ label: string; ms: number }> = [
  { label: '-1天', ms: -24 * 60 * MS_PER_MINUTE },
  { label: '-1小时', ms: -60 * MS_PER_MINUTE },
  { label: '-5分钟', ms: -5 * MS_PER_MINUTE },
  { label: '+5分钟', ms: 5 * MS_PER_MINUTE },
  { label: '+1小时', ms: 60 * MS_PER_MINUTE },
  { label: '+1天', ms: 24 * 60 * MS_PER_MINUTE },
]

/**
 * 调试专用：虚构"当前时间"的面板（仅开发/验收用，不写入任何持久数据）。
 *
 * 入口：在页面任意位置连续键入 "time" 四个字母开/关（监听在 App 层）。
 * 能力：
 * - 快捷按钮：按 5 分钟/1 小时/1 天步进前后平移
 * - 绝对时间：datetime-local 输入，按设备本地时区解释并换算为偏移量
 * - 偏移量只存在内存中，刷新页面即恢复真实时间
 */
export function DebugTimePanel({
  open,
  offsetMs,
  fakeNow,
  timeZone,
  onChangeOffset,
  onClose,
}: DebugTimePanelProps) {
  const [inputValue, setInputValue] = useState('')

  // 面板展开时支持 Esc 关闭；全局 "time" 热键不与 Esc 冲突
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const offsetMinutes = Math.round(offsetMs / MS_PER_MINUTE)

  /** 绝对时间 → 偏移量：以设定瞬间的真实时间为锚点换算，此后随真实时钟同步前进。 */
  const handleAbsoluteChange = (value: string) => {
    setInputValue(value)
    if (value === '') return
    const parsed = new Date(value).getTime()
    if (Number.isNaN(parsed)) return
    onChangeOffset(parsed - Date.now())
  }

  const handleReset = () => {
    setInputValue('')
    onChangeOffset(0)
  }

  return (
    <section className="debug-panel" role="dialog" aria-label="调试时间面板">
      <div className="debug-head">
        <strong>调试：虚构当前时间</strong>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="debug-line">
        <span>
          旅行时区 {formatZonedTime(fakeNow, timeZone)}
          {' · 偏移 '}
          {offsetMinutes === 0 ? '0' : offsetMinutes > 0 ? `+${offsetMinutes}` : offsetMinutes}
          {' 分钟'}
        </span>
      </p>
      <div className="debug-actions">
        {OFFSET_STEPS.map((step) => (
          <button
            key={step.label}
            type="button"
            onClick={() => onChangeOffset(offsetMs + step.ms)}
          >
            {step.label}
          </button>
        ))}
        <button type="button" onClick={handleReset}>
          回到真实时间
        </button>
      </div>
      <label className="debug-line">
        <span>设定绝对时间（设备时区）：</span>
        <input
          type="datetime-local"
          value={inputValue}
          onChange={(event) => handleAbsoluteChange(event.target.value)}
        />
      </label>
      <p className="debug-hint">在页面任意处连续键入 time 可开关本面板；偏移仅本次会话有效</p>
    </section>
  )
}
