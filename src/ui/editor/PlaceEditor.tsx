import { useState } from 'react'
import { TIME_STEP_MINUTES } from '../../domain/config'
import { findLeg } from '../../domain/current'
import {
  dayKeyToUtcEpoch,
  formatMinuteOfDay,
  getZonedMinuteOfDay,
  roundMinutesToStep,
} from '../../domain/time'
import type {
  AlternativePlace,
  DateISO,
  MinuteOfDay,
  PlaceSlot,
} from '../../domain/types'
import { useTripStore } from '../../state/tripStore'
import {
  parseCoordinate,
  parseOptionalMinutes,
  parsePriority,
  parseTimeInput,
} from './formUtils'

interface PlaceEditorProps {
  dayKey: DateISO
  legIndex: number
}

/** 备选地点的表单行（字符串态，保存时统一解析校验）。 */
interface AlternativeForm {
  id: string
  name: string
  lat: string
  lng: string
  priority: string
}

/**
 * 地点编辑表单（需求 8.2 表单式精确修改）：
 * 名称、坐标、开始时间（旅行时区 HH:mm）、停留时长、开放时间、
 * 停留上下限、优先级、固定开始、备选地点。
 * 表单值为组件本地状态，仅"保存"时写入 store。
 */
export function PlaceEditor({ dayKey, legIndex }: PlaceEditorProps) {
  const trip = useTripStore((state) => state.trip)
  const savePlaceEdit = useTripStore((state) => state.savePlaceEdit)
  const insertPlace = useTripStore((state) => state.insertPlace)
  const deletePlace = useTripStore((state) => state.deletePlace)
  const closeEditor = useTripStore((state) => state.closeEditor)

  const leg = findLeg(trip, dayKey, legIndex)
  const place = leg?.place
  const timeZone = trip.timezone

  const [name, setName] = useState(place?.name ?? '')
  const [lat, setLat] = useState(place ? String(place.location.lat) : '0')
  const [lng, setLng] = useState(place ? String(place.location.lng) : '0')
  const [startValue, setStartValue] = useState(() =>
    place ? formatMinuteOfDay(getZonedMinuteOfDay(place.start, timeZone)) : '09:00',
  )
  const [duration, setDuration] = useState(place ? String(place.durationMinutes) : '60')
  const [openValue, setOpenValue] = useState(
    place?.open != null ? formatMinuteOfDay(place.open) : '',
  )
  const [closeValue, setCloseValue] = useState(
    place?.close != null ? formatMinuteOfDay(place.close) : '',
  )
  const [minStay, setMinStay] = useState(
    place?.minStayMinutes != null ? String(place.minStayMinutes) : '',
  )
  const [maxStay, setMaxStay] = useState(
    place?.maxStayMinutes != null ? String(place.maxStayMinutes) : '',
  )
  const [priority, setPriority] = useState(place ? String(place.priority) : '5')
  const fixedEnabledInitial = place?.fixedStart != null
  const [fixedEnabled, setFixedEnabled] = useState(fixedEnabledInitial)
  const [fixedValue, setFixedValue] = useState(
    place?.fixedStart != null ? formatMinuteOfDay(place.fixedStart) : '',
  )
  const [alternatives, setAlternatives] = useState<AlternativeForm[]>(() =>
    (leg?.alternatives ?? []).map((alternative) => ({
      id: alternative.id,
      name: alternative.name,
      lat: String(alternative.location.lat),
      lng: String(alternative.location.lng),
      priority: String(alternative.priority),
    })),
  )
  const [error, setError] = useState<string | null>(null)

  if (!place) return null

  /** 解析并校验全部字段，失败时返回错误文案；成功返回可提交的数据。 */
  const buildResult = ():
    | { ok: true; place: PlaceSlot; alternatives: AlternativePlace[] }
    | { ok: false; message: string } => {
    const trimmedName = name.trim()
    if (trimmedName === '') return { ok: false, message: '名称不能为空' }
    const parsedLat = parseCoordinate(lat, -90, 90)
    if (parsedLat === undefined) return { ok: false, message: '纬度需在 -90 到 90 之间' }
    const parsedLng = parseCoordinate(lng, -180, 180)
    if (parsedLng === undefined) return { ok: false, message: '经度需在 -180 到 180 之间' }
    const startMinute = parseTimeInput(startValue)
    if (startMinute === null) return { ok: false, message: '开始时间格式应为 HH:mm' }
    const parsedDuration = parseOptionalMinutes(duration)
    if (parsedDuration === undefined || parsedDuration === null) {
      return { ok: false, message: '停留时长必须为正数分钟' }
    }
    const parsedOpen = parseTimeInput(openValue)
    if (openValue.trim() !== '' && parsedOpen === null) {
      return { ok: false, message: '开放时间格式应为 HH:mm' }
    }
    const parsedClose = parseTimeInput(closeValue)
    if (closeValue.trim() !== '' && parsedClose === null) {
      return { ok: false, message: '关门时间格式应为 HH:mm' }
    }
    if (parsedOpen !== null && parsedClose !== null && parsedOpen >= parsedClose) {
      return { ok: false, message: '开放开始必须早于关门时间' }
    }
    const parsedMinStay = parseOptionalMinutes(minStay)
    if (parsedMinStay === undefined) return { ok: false, message: '最短停留需为正数分钟或留空' }
    const parsedMaxStay = parseOptionalMinutes(maxStay)
    if (parsedMaxStay === undefined) return { ok: false, message: '最长停留需为正数分钟或留空' }
    if (
      parsedMinStay !== null &&
      parsedMaxStay !== null &&
      parsedMinStay > parsedMaxStay
    ) {
      return { ok: false, message: '最短停留不能大于最长停留' }
    }
    const parsedPriority = parsePriority(priority)
    if (parsedPriority === undefined) return { ok: false, message: '优先级需为不小于 1 的整数' }
    let parsedFixed: MinuteOfDay | null = null
    if (fixedEnabled) {
      parsedFixed = parseTimeInput(fixedValue)
      if (parsedFixed === null) return { ok: false, message: '固定开始时间格式应为 HH:mm' }
    }
    const builtAlternatives: AlternativePlace[] = []
    for (const row of alternatives) {
      if (row.name.trim() === '' && row.lat.trim() === '' && row.lng.trim() === '') {
        continue
      }
      const altLat = parseCoordinate(row.lat, -90, 90)
      const altLng = parseCoordinate(row.lng, -180, 180)
      const altPriority = parsePriority(row.priority)
      if (altLat === undefined || altLng === undefined || altPriority === undefined) {
        return { ok: false, message: `备选「${row.name.trim() || '未命名'}」的坐标或优先级不合法` }
      }
      builtAlternatives.push({
        id: row.id,
        name: row.name.trim(),
        location: { lat: altLat, lng: altLng },
        priority: altPriority,
        open: null,
        close: null,
        minStayMinutes: null,
        maxStayMinutes: null,
        fixedStart: null,
      })
    }
    const durationMinutes = Math.max(
      TIME_STEP_MINUTES,
      roundMinutesToStep(parsedDuration),
    )
    return {
      ok: true,
      place: {
        id: place.id,
        name: trimmedName,
        location: { lat: parsedLat, lng: parsedLng },
        priority: parsedPriority,
        start: dayKeyToUtcEpoch(dayKey, roundMinutesToStep(startMinute), timeZone),
        durationMinutes,
        open: parsedOpen,
        close: parsedClose,
        minStayMinutes: parsedMinStay === null ? null : roundMinutesToStep(parsedMinStay),
        maxStayMinutes: parsedMaxStay === null ? null : roundMinutesToStep(parsedMaxStay),
        fixedStart: parsedFixed,
      },
      alternatives: builtAlternatives,
    }
  }

  const handleSave = () => {
    const result = buildResult()
    if (!result.ok) {
      setError(result.message)
      return
    }
    savePlaceEdit(dayKey, legIndex, result.place, result.alternatives)
  }

  const handleDelete = () => {
    if (window.confirm(`删除「${place.name}」？该操作直接修改计划。`)) {
      deletePlace(dayKey, legIndex)
    }
  }

  const updateAlternative = (index: number, patch: Partial<AlternativeForm>) => {
    setAlternatives((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  return (
    <div className="editor-form">
      <label className="field">
        <span>名称</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>纬度</span>
          <input
            value={lat}
            inputMode="decimal"
            onChange={(event) => setLat(event.target.value)}
          />
        </label>
        <label className="field">
          <span>经度</span>
          <input
            value={lng}
            inputMode="decimal"
            onChange={(event) => setLng(event.target.value)}
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>开始时间（{timeZone}）</span>
          <input
            type="time"
            step={TIME_STEP_MINUTES * 60}
            value={startValue}
            onChange={(event) => setStartValue(event.target.value)}
          />
        </label>
        <label className="field">
          <span>停留时长（分钟）</span>
          <input
            value={duration}
            inputMode="numeric"
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>开放时间（留空不限）</span>
          <input
            type="time"
            value={openValue}
            onChange={(event) => setOpenValue(event.target.value)}
          />
        </label>
        <label className="field">
          <span>关门时间（留空不限）</span>
          <input
            type="time"
            value={closeValue}
            onChange={(event) => setCloseValue(event.target.value)}
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>最短停留（留空可取消）</span>
          <input
            value={minStay}
            inputMode="numeric"
            onChange={(event) => setMinStay(event.target.value)}
          />
        </label>
        <label className="field">
          <span>最长停留（留空无上限）</span>
          <input
            value={maxStay}
            inputMode="numeric"
            onChange={(event) => setMaxStay(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>优先级（1 最高）</span>
        <input
          value={priority}
          inputMode="numeric"
          onChange={(event) => setPriority(event.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="field-check">
          <input
            type="checkbox"
            checked={fixedEnabled}
            onChange={(event) => setFixedEnabled(event.target.checked)}
          />
          <span>固定开始时间（硬约束）</span>
        </label>
        {fixedEnabled && (
          <input
            type="time"
            value={fixedValue}
            onChange={(event) => setFixedValue(event.target.value)}
            aria-label="固定开始时间"
          />
        )}
      </div>
      <div className="field">
        <span>备选地点（原计划出问题时的候选）</span>
        {alternatives.map((row, index) => (
          <div key={row.id} className="alt-row">
            <input
              value={row.name}
              placeholder="名称"
              onChange={(event) => updateAlternative(index, { name: event.target.value })}
            />
            <div className="alt-row-grid">
              <input
                value={row.lat}
                placeholder="纬度"
                inputMode="decimal"
                onChange={(event) => updateAlternative(index, { lat: event.target.value })}
              />
              <input
                value={row.lng}
                placeholder="经度"
                inputMode="decimal"
                onChange={(event) => updateAlternative(index, { lng: event.target.value })}
              />
              <input
                value={row.priority}
                placeholder="优先级"
                inputMode="numeric"
                onChange={(event) =>
                  updateAlternative(index, { priority: event.target.value })
                }
              />
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  setAlternatives((rows) => rows.filter((_, i) => i !== index))
                }
              >
                删除
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() =>
            setAlternatives((rows) => [
              ...rows,
              {
                id: `alt-${Date.now().toString(36)}-${rows.length}`,
                name: '',
                lat: '',
                lng: '',
                priority: '5',
              },
            ])
          }
        >
          ＋ 添加备选
        </button>
      </div>
      {error !== null && (
        <p className="sheet-error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-accent" onClick={handleSave}>
          保存
        </button>
        <button type="button" className="btn" onClick={closeEditor}>
          取消
        </button>
        <button type="button" className="btn" onClick={() => insertPlace(dayKey, legIndex)}>
          在此后插入
        </button>
        <button type="button" className="btn btn-danger" onClick={handleDelete}>
          删除地点
        </button>
      </div>
    </div>
  )
}
