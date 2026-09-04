import { useState } from 'react'
import { TIME_STEP_MINUTES } from '../../domain/config'
import { findLeg } from '../../domain/current'
import {
  dayKeyToUtcEpoch,
  formatMinuteOfDay,
  getZonedMinuteOfDay,
  roundMinutesToStep,
} from '../../domain/time'
import type { DateISO, MinuteOfDay, PlaceSlot } from '../../domain/types'
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

/**
 * 地点编辑表单（需求 8.2 表单式精确修改）：
 * 名称、坐标、开始时间（旅行时区 HH:mm）、停留时长、开放时间、
 * 停留上下限、优先级、固定开始。
 * 备选地点不在此编辑：它们位于日级备选地点库（需求 7，见 AlternativeEditor）。
 * 表单值为组件本地状态，仅"保存"时写入 store。
 */
export function PlaceEditor({ dayKey, legIndex }: PlaceEditorProps) {
  const trip = useTripStore((state) => state.trip)
  const savePlaceEdit = useTripStore((state) => state.savePlaceEdit)
  const insertPlace = useTripStore((state) => state.insertPlace)
  const insertTransport = useTripStore((state) => state.insertTransport)
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
  // 错误关联到具体字段（阶段 4 可访问性）：aria-invalid 标记出错输入框，
  // aria-describedby 指向错误文案，保存失败时聚焦首个出错字段
  const [error, setError] = useState<{ field: string; message: string } | null>(null)

  if (!place) return null

  const fieldAria = (field: string) => ({
    id: `pe-${field}`,
    'aria-invalid': error?.field === field || undefined,
    'aria-describedby': error !== null ? 'editor-form-error' : undefined,
  })

  /** 解析并校验全部字段，失败时返回出错字段与文案；成功返回可提交的数据。 */
  const buildResult = ():
    | { ok: true; place: PlaceSlot }
    | { ok: false; field: string; message: string } => {
    const trimmedName = name.trim()
    if (trimmedName === '') return { ok: false, field: 'name', message: '名称不能为空' }
    const parsedLat = parseCoordinate(lat, -90, 90)
    if (parsedLat === undefined)
      return { ok: false, field: 'lat', message: '纬度需在 -90 到 90 之间' }
    const parsedLng = parseCoordinate(lng, -180, 180)
    if (parsedLng === undefined)
      return { ok: false, field: 'lng', message: '经度需在 -180 到 180 之间' }
    const startMinute = parseTimeInput(startValue)
    if (startMinute === null)
      return { ok: false, field: 'start', message: '开始时间格式应为 HH:mm' }
    const parsedDuration = parseOptionalMinutes(duration)
    if (parsedDuration === undefined || parsedDuration === null) {
      return { ok: false, field: 'duration', message: '停留时长必须为正数分钟' }
    }
    const parsedOpen = parseTimeInput(openValue)
    if (openValue.trim() !== '' && parsedOpen === null) {
      return { ok: false, field: 'open', message: '开放时间格式应为 HH:mm' }
    }
    const parsedClose = parseTimeInput(closeValue)
    if (closeValue.trim() !== '' && parsedClose === null) {
      return { ok: false, field: 'close', message: '关门时间格式应为 HH:mm' }
    }
    if (parsedOpen !== null && parsedClose !== null && parsedOpen >= parsedClose) {
      return { ok: false, field: 'open', message: '开放开始必须早于关门时间' }
    }
    const parsedMinStay = parseOptionalMinutes(minStay)
    if (parsedMinStay === undefined)
      return { ok: false, field: 'minStay', message: '最短停留需为正数分钟或留空' }
    const parsedMaxStay = parseOptionalMinutes(maxStay)
    if (parsedMaxStay === undefined)
      return { ok: false, field: 'maxStay', message: '最长停留需为正数分钟或留空' }
    if (
      parsedMinStay !== null &&
      parsedMaxStay !== null &&
      parsedMinStay > parsedMaxStay
    ) {
      return { ok: false, field: 'minStay', message: '最短停留不能大于最长停留' }
    }
    const parsedPriority = parsePriority(priority)
    if (parsedPriority === undefined)
      return { ok: false, field: 'priority', message: '优先级需为不小于 1 的整数' }
    let parsedFixed: MinuteOfDay | null = null
    if (fixedEnabled) {
      parsedFixed = parseTimeInput(fixedValue)
      if (parsedFixed === null)
        return { ok: false, field: 'fixed', message: '固定开始时间格式应为 HH:mm' }
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
    }
  }

  const handleSave = () => {
    const result = buildResult()
    if (!result.ok) {
      setError({ field: result.field, message: result.message })
      document.getElementById(`pe-${result.field}`)?.focus()
      return
    }
    savePlaceEdit(dayKey, legIndex, result.place)
  }

  const handleDelete = () => {
    if (window.confirm(`删除「${place.name}」？该操作直接修改计划。`)) {
      deletePlace(dayKey, legIndex)
    }
  }

  return (
    <div className="editor-form">
      <label className="field">
        <span>名称</span>
        <input
          {...fieldAria('name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>纬度</span>
          <input
            {...fieldAria('lat')}
            value={lat}
            inputMode="decimal"
            onChange={(event) => setLat(event.target.value)}
          />
        </label>
        <label className="field">
          <span>经度</span>
          <input
            {...fieldAria('lng')}
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
            {...fieldAria('start')}
            type="time"
            step={TIME_STEP_MINUTES * 60}
            value={startValue}
            onChange={(event) => setStartValue(event.target.value)}
          />
        </label>
        <label className="field">
          <span>停留时长（分钟）</span>
          <input
            {...fieldAria('duration')}
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
            {...fieldAria('open')}
            type="time"
            value={openValue}
            onChange={(event) => setOpenValue(event.target.value)}
          />
        </label>
        <label className="field">
          <span>关门时间（留空不限）</span>
          <input
            {...fieldAria('close')}
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
            {...fieldAria('minStay')}
            value={minStay}
            inputMode="numeric"
            onChange={(event) => setMinStay(event.target.value)}
          />
        </label>
        <label className="field">
          <span>最长停留（留空无上限）</span>
          <input
            {...fieldAria('maxStay')}
            value={maxStay}
            inputMode="numeric"
            onChange={(event) => setMaxStay(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>优先级（1 最高）</span>
        <input
          {...fieldAria('priority')}
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
            {...fieldAria('fixed')}
            type="time"
            value={fixedValue}
            onChange={(event) => setFixedValue(event.target.value)}
            aria-label="固定开始时间"
          />
        )}
      </div>
      {error !== null && (
        <p className="sheet-error" id="editor-form-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          保存
        </button>
        <button type="button" className="btn" onClick={closeEditor}>
          取消
        </button>
        <button type="button" className="btn" onClick={() => insertPlace(dayKey, legIndex)}>
          在此后插入
        </button>
        {legIndex > 0 && !leg.transport && (
          <button type="button" className="btn" onClick={() => insertTransport(dayKey, legIndex)}>
            在此前插入交通
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={handleDelete}>
          删除地点
        </button>
      </div>
    </div>
  )
}
