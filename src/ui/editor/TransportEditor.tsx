import { useState } from 'react'
import { SPEED_ANOMALY_RATIO, TIME_STEP_MINUTES } from '../../domain/config'
import { findLeg } from '../../domain/current'
import { haversineKm, impliedSpeedKmh } from '../../domain/geo'
import { roundMinutesToStep } from '../../domain/time'
import type { DateISO } from '../../domain/types'
import { useTripStore } from '../../state/tripStore'

interface TransportEditorProps {
  dayKey: DateISO
  legIndex: number
}

/**
 * 交通编辑表单（需求 8.2 / 4.4）：
 * 只编辑交通时长；距离由前后坐标决定，隐含速度随时长即时预览，
 * 与基准速度偏差超阈值时在表单内给出提示。
 */
export function TransportEditor({ dayKey, legIndex }: TransportEditorProps) {
  const trip = useTripStore((state) => state.trip)
  const saveTransportEdit = useTripStore((state) => state.saveTransportEdit)
  const closeEditor = useTripStore((state) => state.closeEditor)

  const leg = findLeg(trip, dayKey, legIndex)
  const transport = leg?.transport
  const [duration, setDuration] = useState(
    transport ? String(transport.durationMinutes) : '30',
  )
  // 错误关联到时长输入框（阶段 4 可访问性）
  const [error, setError] = useState(false)

  if (!leg || !transport) return null

  const distanceKm = haversineKm(transport.from, leg.place.location)
  const baseSpeed = transport.baseSpeedKmh
  const parsed = Number(duration.trim())
  const valid = Number.isFinite(parsed) && parsed > 0
  const previewSpeed = valid
    ? impliedSpeedKmh(distanceKm, roundMinutesToStep(parsed))
    : null
  const previewAnomaly =
    baseSpeed !== null &&
    previewSpeed !== null &&
    Math.abs(previewSpeed - baseSpeed) / baseSpeed > SPEED_ANOMALY_RATIO

  const handleSave = () => {
    if (!valid) {
      setError(true)
      document.getElementById('te-duration')?.focus()
      return
    }
    saveTransportEdit(
      dayKey,
      legIndex,
      Math.max(TIME_STEP_MINUTES, roundMinutesToStep(parsed)),
    )
  }

  return (
    <div className="editor-form">
      <p className="editor-info">
        前往「{leg.place.name}」 · 距离约 {distanceKm.toFixed(2)} 公里 ·
        基准速度 {baseSpeed !== null ? `${baseSpeed} km/h` : '未建立'}
      </p>
      <label className="field">
        <span>交通时长（分钟）</span>
        <input
          id="te-duration"
          aria-invalid={error || undefined}
          aria-describedby={error ? 'editor-form-error' : undefined}
          value={duration}
          inputMode="numeric"
          onChange={(event) => setDuration(event.target.value)}
        />
      </label>
      {previewSpeed !== null && (
        <p className="editor-info">
          按当前时长隐含速度约 {previewSpeed} km/h
          {previewAnomaly && ' · 与基准偏差较大，请确认是否合理'}
        </p>
      )}
      {error && (
        <p className="sheet-error" id="editor-form-error" role="alert">
          交通时长必须为正数分钟
        </p>
      )}
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
