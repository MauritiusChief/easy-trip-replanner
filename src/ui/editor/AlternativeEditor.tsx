import { useState } from 'react'
import { TIME_STEP_MINUTES } from '../../domain/config'
import { findAlternative } from '../../domain/current'
import {
  formatMinuteOfDay,
  roundMinutesToStep,
} from '../../domain/time'
import type {
  AlternativePlace,
  DateISO,
  MinuteOfDay,
  PlaceId,
} from '../../domain/types'
import { useTripStore } from '../../state/tripStore'
import {
  parseCoordinate,
  parseOptionalMinutes,
  parsePriority,
  parseTimeInput,
} from './formUtils'
import { SearchSelect } from './SearchSelect'

interface AlternativeEditorProps {
  dayKey: DateISO
  /** null 表示新建条目，否则编辑库中对应 id 的条目。 */
  altId: PlaceId | null
}

/**
 * 备选地点编辑表单（需求 7：日级备选地点库）。
 * 备选条目属性完全独立：名称、坐标、计划停留时长、开放时间、
 * 停留上下限、优先级、固定开始，以及到当日计划地点的链接（可为未连接）。
 * 表单值为组件本地状态，仅"保存"时写入 store。
 */
export function AlternativeEditor({ dayKey, altId }: AlternativeEditorProps) {
  const trip = useTripStore((state) => state.trip)
  const saveAlternative = useTripStore((state) => state.saveAlternative)
  const deleteAlternative = useTripStore((state) => state.deleteAlternative)
  const closeEditor = useTripStore((state) => state.closeEditor)

  const existing = altId !== null ? findAlternative(trip, dayKey, altId) : undefined
  const day = trip.days.find((entry) => entry.date === dayKey)
  const timeZone = trip.timezone

  const [name, setName] = useState(existing?.name ?? '')
  const [lat, setLat] = useState(
    existing ? String(existing.location.lat) : '0',
  )
  const [lng, setLng] = useState(
    existing ? String(existing.location.lng) : '0',
  )
  const [duration, setDuration] = useState(
    existing ? String(existing.durationMinutes) : '60',
  )
  const [openValue, setOpenValue] = useState(
    existing?.open != null ? formatMinuteOfDay(existing.open) : '',
  )
  const [closeValue, setCloseValue] = useState(
    existing?.close != null ? formatMinuteOfDay(existing.close) : '',
  )
  const [minStay, setMinStay] = useState(
    existing?.minStayMinutes != null ? String(existing.minStayMinutes) : '',
  )
  const [maxStay, setMaxStay] = useState(
    existing?.maxStayMinutes != null ? String(existing.maxStayMinutes) : '',
  )
  const [priority, setPriority] = useState(
    existing ? String(existing.priority) : '5',
  )
  const [fixedEnabled, setFixedEnabled] = useState(existing?.fixedStart != null)
  const [fixedValue, setFixedValue] = useState(
    existing?.fixedStart != null ? formatMinuteOfDay(existing.fixedStart) : '',
  )
  const [linkedId, setLinkedId] = useState(existing?.linkedPlaceId ?? '')
  // 错误关联到具体字段（阶段 4 可访问性）
  const [error, setError] = useState<{ field: string; message: string } | null>(null)

  if (!day) return null

  const fieldAria = (field: string) => ({
    id: `ae-${field}`,
    'aria-invalid': error?.field === field || undefined,
    'aria-describedby': error !== null ? 'editor-form-error' : undefined,
  })

  /**
   * 切换链接地点时，新建态且坐标仍是默认值的情况下，
   * 用链接目标的坐标预填（备选通常在原地点附近，减少手输成本）。
   */
  const handleLinkChange = (nextId: string) => {
    setLinkedId(nextId)
    if (altId === null && lat.trim() === '0' && lng.trim() === '0') {
      const target = day.legs.find((leg) => leg.place.id === nextId)?.place
      if (target) {
        setLat(String(target.location.lat))
        setLng(String(target.location.lng))
      }
    }
  }

  const buildResult = ():
    | { ok: true; alternative: AlternativePlace }
    | { ok: false; field: string; message: string } => {
    const trimmedName = name.trim()
    if (trimmedName === '') return { ok: false, field: 'name', message: '名称不能为空' }
    const parsedLat = parseCoordinate(lat, -90, 90)
    if (parsedLat === undefined)
      return { ok: false, field: 'lat', message: '纬度需在 -90 到 90 之间' }
    const parsedLng = parseCoordinate(lng, -180, 180)
    if (parsedLng === undefined)
      return { ok: false, field: 'lng', message: '经度需在 -180 到 180 之间' }
    const parsedDuration = parseOptionalMinutes(duration)
    if (parsedDuration === undefined || parsedDuration === null) {
      return { ok: false, field: 'duration', message: '计划停留时长必须为正数分钟' }
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
    return {
      ok: true,
      alternative: {
        id: existing?.id ?? `alt-${Date.now().toString(36)}`,
        name: trimmedName,
        location: { lat: parsedLat, lng: parsedLng },
        priority: parsedPriority,
        durationMinutes: Math.max(
          TIME_STEP_MINUTES,
          roundMinutesToStep(parsedDuration),
        ),
        open: parsedOpen,
        close: parsedClose,
        minStayMinutes: parsedMinStay === null ? null : roundMinutesToStep(parsedMinStay),
        maxStayMinutes: parsedMaxStay === null ? null : roundMinutesToStep(parsedMaxStay),
        fixedStart: parsedFixed,
        linkedPlaceId: linkedId === '' ? null : linkedId,
      },
    }
  }

  const handleSave = () => {
    const result = buildResult()
    if (!result.ok) {
      setError({ field: result.field, message: result.message })
      document.getElementById(`ae-${result.field}`)?.focus()
      return
    }
    saveAlternative(dayKey, result.alternative)
  }

  const handleDelete = () => {
    if (existing && window.confirm(`删除备选「${existing.name}」？`)) {
      deleteAlternative(dayKey, existing.id)
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
          <span>计划停留时长（分钟）</span>
          <input
            {...fieldAria('duration')}
            value={duration}
            inputMode="numeric"
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <label className="field">
          <span>优先级（1 最高）</span>
          <input
            {...fieldAria('priority')}
            value={priority}
            inputMode="numeric"
            onChange={(event) => setPriority(event.target.value)}
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
      <div className="field">
        <span>链接的计划地点（备用于）</span>
        <SearchSelect
          ariaLabel="链接的计划地点"
          value={linkedId}
          placeholder="输入筛选或浏览全部地点"
          options={[
            { value: '', label: '未连接' },
            ...day.legs.map((leg) => ({
              value: leg.place.id,
              label: leg.place.name,
            })),
          ]}
          onChange={handleLinkChange}
        />
      </div>
      {error !== null && (
        <p className="sheet-error" id="editor-form-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-accent" onClick={handleSave}>
          保存
        </button>
        <button type="button" className="btn" onClick={closeEditor}>
          取消
        </button>
        {existing && (
          <button type="button" className="btn btn-danger" onClick={handleDelete}>
            删除备选
          </button>
        )}
      </div>
      <p className="sheet-hint">
        时区：{timeZone}；备选不参与时间轴，仅在重排并勾选"纳入备选地点"时作为替代候选
      </p>
    </div>
  )
}
