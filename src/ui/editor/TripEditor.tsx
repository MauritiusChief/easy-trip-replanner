import { type ChangeEvent, useRef, useState } from 'react'
import { exportTripJson, getTripExportFilename, importTripJson } from '../../data/transfer'
import { TIME_STEP_MINUTES } from '../../domain/config'
import { isValidTimeZone } from '../../domain/time'
import { roundMinutesToStep } from '../../domain/time'
import type { DateISO } from '../../domain/types'
import { useTripStore } from '../../state/tripStore'
import { parseTimeInput } from './formUtils'

/**
 * 行程设置表单：名称、时区、日期范围与统一每日窗口。
 * 应用不内置示例行程，新用户从这里把空行程改成自己的未来旅行计划。
 *
 * - 缩小日期范围会删除范围外整天的行程与备选库（破坏性），保存前确认
 * - 时区只改变显示换算：既有时刻是 UTC 绝对值，不随换区平移
 */
export function TripEditor() {
  const trip = useTripStore((state) => state.trip)
  const saveTripSettings = useTripStore((state) => state.saveTripSettings)
  const replaceTrip = useTripStore((state) => state.replaceTrip)
  const closeEditor = useTripStore((state) => state.closeEditor)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(trip.name)
  const [timezone, setTimezone] = useState(trip.timezone)
  const [startDate, setStartDate] = useState(trip.startDate)
  const [endDate, setEndDate] = useState(trip.endDate)
  const [windowStart, setWindowStart] = useState(() => {
    const minutes = trip.dailyStart
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
  const [windowEnd, setWindowEnd] = useState(() => {
    const minutes = trip.dailyEnd
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
  const [error, setError] = useState<{ field: string; message: string } | null>(null)

  const fieldAria = (field: string) => ({
    id: `ts-${field}`,
    'aria-invalid': error?.field === field || undefined,
    'aria-describedby': error !== null ? 'trip-form-error' : undefined,
  })

  const isDateIso = (value: string): value is DateISO => /^\d{4}-\d{2}-\d{2}$/.test(value)

  const handleSave = () => {
    const trimmedName = name.trim()
    if (trimmedName === '') {
      setError({ field: 'name', message: '行程名称不能为空' })
      document.getElementById('ts-name')?.focus()
      return
    }
    if (!isValidTimeZone(timezone.trim())) {
      setError({ field: 'timezone', message: '时区需为有效的 IANA 名称（如 Asia/Shanghai）' })
      document.getElementById('ts-timezone')?.focus()
      return
    }
    if (!isDateIso(startDate) || !isDateIso(endDate)) {
      setError({ field: 'startDate', message: '日期格式应为 YYYY-MM-DD' })
      document.getElementById('ts-startDate')?.focus()
      return
    }
    if (startDate > endDate) {
      setError({ field: 'startDate', message: '开始日期不能晚于结束日期' })
      document.getElementById('ts-startDate')?.focus()
      return
    }
    const parsedWindowStart = parseTimeInput(windowStart)
    if (parsedWindowStart === null) {
      setError({ field: 'windowStart', message: '窗口开始格式应为 HH:mm' })
      document.getElementById('ts-windowStart')?.focus()
      return
    }
    const parsedWindowEnd = parseTimeInput(windowEnd)
    if (parsedWindowEnd === null) {
      setError({ field: 'windowEnd', message: '窗口结束格式应为 HH:mm' })
      document.getElementById('ts-windowEnd')?.focus()
      return
    }
    const dailyStart = roundMinutesToStep(parsedWindowStart)
    const dailyEnd = roundMinutesToStep(parsedWindowEnd)
    if (dailyStart >= dailyEnd) {
      setError({ field: 'windowStart', message: '窗口开始必须早于窗口结束' })
      document.getElementById('ts-windowStart')?.focus()
      return
    }
    // 破坏性确认：新范围之外存在有内容的整天（行程或备选）时提示
    const dropsContent = trip.days.some(
      (day) =>
        (day.date < startDate || day.date > endDate) &&
        (day.legs.length > 0 || day.alternatives.length > 0),
    )
    if (
      dropsContent &&
      !window.confirm('缩小日期范围会删除范围外整天的行程与备选库，且无法恢复。确定继续？')
    ) {
      return
    }
    setError(null)
    saveTripSettings({
      name: trimmedName,
      timezone: timezone.trim(),
      startDate,
      endDate,
      dailyStart,
      dailyEnd,
    })
  }

  const handleExport = () => {
    const blob = new Blob([exportTripJson(trip)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getTripExportFilename(trip.name)
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    let imported = null
    try {
      imported = importTripJson(await file.text())
    } catch {
      setError({ field: 'import', message: '无法读取所选文件' })
      return
    }
    if (!imported) {
      setError({ field: 'import', message: '所选文件不是可加载的行程 JSON' })
      return
    }
    if (!window.confirm('加载 JSON 会覆盖当前行程和未完成的手动重排，且无法恢复。确定继续？')) {
      return
    }
    replaceTrip(imported)
  }

  return (
    <div className="editor-form">
      <label className="field">
        <span>行程名称</span>
        <input
          {...fieldAria('name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span>旅行时区（IANA 名称）</span>
        <input
          {...fieldAria('timezone')}
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>开始日期</span>
          <input
            {...fieldAria('startDate')}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field">
          <span>结束日期</span>
          <input
            {...fieldAria('endDate')}
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>每日窗口开始</span>
          <input
            {...fieldAria('windowStart')}
            type="time"
            step={TIME_STEP_MINUTES * 60}
            value={windowStart}
            onChange={(event) => setWindowStart(event.target.value)}
          />
        </label>
        <label className="field">
          <span>每日窗口结束</span>
          <input
            {...fieldAria('windowEnd')}
            type="time"
            step={TIME_STEP_MINUTES * 60}
            value={windowEnd}
            onChange={(event) => setWindowEnd(event.target.value)}
          />
        </label>
      </div>
      {error !== null && (
        <p className="sheet-error" id="trip-form-error" role="alert">
          {error.message}
        </p>
      )}
      <p className="editor-info">
        改变时区不会平移既有安排的时刻；缩小日期范围会删除范围外的整天数据；加载会覆盖当前行程。
      </p>
      <div className="data-transfer-actions">
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          aria-label="选择行程 JSON 文件"
          onChange={handleImport}
        />
        <button type="button" className="btn" onClick={handleExport}>
          导出 JSON
        </button>
        <button type="button" className="btn" onClick={() => importInputRef.current?.click()}>
          加载 JSON
        </button>
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          保存
        </button>
        <button type="button" className="btn" onClick={closeEditor}>
          取消
        </button>
      </div>
    </div>
  )
}
