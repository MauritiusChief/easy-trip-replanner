import { useState } from 'react'
import { MS_PER_MINUTE, TIME_STEP_MINUTES } from '../domain/config'
import { remainingPendingIds, resolveSessionPredecessor } from '../domain/manualReorder'
import {
  dayKeyToUtcEpoch,
  formatMinuteOfDay,
  formatZonedTime,
  getZonedMinuteOfDay,
  roundMinutesToStep,
} from '../domain/time'
import type { DayPlan, EpochMs, Leg, PlaceSlot, Trip } from '../domain/types'
import { useTripStore } from '../state/tripStore'
import { parseTimeInput } from './editor/formUtils'
import './ReorderPanel.css'

/**
 * 手动重排面板（阶段 2）：
 * - 待选卡槽逐张展示，每张卡显示原计划开始时间、停留时长、原前序地点、
 *   原交通时长，以及开放时间、优先级和停留限制等参考信息
 * - 点开卡片填写新的开始时间与到达交通时长，保存即调用阶段 1 的
 *   原子 mutation 写入正式行程，时间轴与警告即时刷新
 * - 固定时间与进行中的行程不在卡槽中（已由会话排除），面板给出锁定说明
 * - 退出仅关闭面板：已保存的调整不回滚，未选卡片保留原计划
 */

/** 停留约束摘要（与 DayView 的 stayLabel 同语义，样式类独立避免跨组件依赖）。 */
function stayLabel(minStay: number | null, maxStay: number | null): string | null {
  if (minStay !== null && maxStay !== null) return `停留 ${minStay}–${maxStay} 分钟`
  if (minStay !== null) return `停留 ≥${minStay} 分钟`
  if (maxStay !== null) return `停留 ≤${maxStay} 分钟`
  return null
}

/** 待选卡参考信息：填写前可见，用户无需记忆原时间或交通时长。 */
function CardReference({
  leg,
  prevPlace,
  timeZone,
}: {
  leg: Leg
  prevPlace: PlaceSlot | null
  timeZone: string
}) {
  const place = leg.place
  const endUtc: EpochMs = place.start + place.durationMinutes * MS_PER_MINUTE
  const stay = stayLabel(place.minStayMinutes, place.maxStayMinutes)
  return (
    <>
      <div className="reorder-card-top">
        <span className="reorder-card-name">{place.name}</span>
        <span className="reorder-card-time">
          {formatZonedTime(place.start, timeZone)}–{formatZonedTime(endUtc, timeZone)}
        </span>
      </div>
      <div className="reorder-card-refs">
        <span>原计划停留 {place.durationMinutes} 分钟</span>
        <span>
          {prevPlace !== null
            ? `原从前序「${prevPlace.name}」出发 · 原交通 ${
                leg.transport ? `${leg.transport.durationMinutes} 分钟` : '无'
              }`
            : '当天首段，无前序地点'}
        </span>
      </div>
      <div className="reorder-card-chips">
        <span className="reorder-chip">优先级 {place.priority}</span>
        {place.open !== null && place.close !== null && (
          <span className="reorder-chip">
            开放 {formatMinuteOfDay(place.open)}–{formatMinuteOfDay(place.close)}
          </span>
        )}
        {stay !== null && <span className="reorder-chip">{stay}</span>}
        {place.minStayMinutes === null && (
          <span className="reorder-chip reorder-chip-cancellable">可取消</span>
        )}
      </div>
    </>
  )
}

/** 单张待选卡的填写表单：预填原计划值，按 5 分钟粒度解析和校验。 */
function ReorderCardForm({
  day,
  leg,
  prevPlace,
  predecessorName,
  timeZone,
}: {
  day: DayPlan
  leg: Leg
  prevPlace: PlaceSlot | null
  predecessorName: string | null
  timeZone: string
}) {
  const saveReorderCard = useTripStore((state) => state.saveReorderCard)
  const closeReorderCard = useTripStore((state) => state.closeReorderCard)
  const [startValue, setStartValue] = useState(() =>
    formatMinuteOfDay(getZonedMinuteOfDay(leg.place.start, timeZone)),
  )
  const [durationValue, setDurationValue] = useState(() =>
    String(leg.transport ? leg.transport.durationMinutes : 30),
  )
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    const startMinute = parseTimeInput(startValue)
    if (startMinute === null) {
      setError('开始时间格式应为 HH:mm')
      document.getElementById('reorder-start')?.focus()
      return
    }
    const parsedDuration = Number(durationValue.trim())
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setError('到达交通时长必须为正数分钟')
      document.getElementById('reorder-duration')?.focus()
      return
    }
    setError(null)
    saveReorderCard({
      placeId: leg.place.id,
      start: dayKeyToUtcEpoch(day.date, roundMinutesToStep(startMinute), timeZone),
      transportDurationMinutes: Math.max(
        TIME_STEP_MINUTES,
        roundMinutesToStep(parsedDuration),
      ),
    })
  }

  return (
    <div className="reorder-form">
      <CardReference leg={leg} prevPlace={prevPlace} timeZone={timeZone} />
      <p className="reorder-form-hint">
        {predecessorName !== null
          ? `保存后将从前序「${predecessorName}」出发`
          : '没有可确定的前序地点：保存后此段不创建到达交通'}
      </p>
      <div className="reorder-form-grid">
        <label className="reorder-field">
          <span>新的开始时间（{timeZone}）</span>
          <input
            id="reorder-start"
            type="time"
            step={TIME_STEP_MINUTES * 60}
            value={startValue}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? 'reorder-form-error' : undefined}
            onChange={(event) => setStartValue(event.target.value)}
          />
        </label>
        <label className="reorder-field">
          <span>到达交通时长（分钟）</span>
          <input
            id="reorder-duration"
            inputMode="numeric"
            value={durationValue}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? 'reorder-form-error' : undefined}
            onChange={(event) => setDurationValue(event.target.value)}
          />
        </label>
      </div>
      {error !== null && (
        <p className="reorder-error" id="reorder-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="reorder-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave}>
          保存并下一张
        </button>
        <button type="button" className="btn" onClick={closeReorderCard}>
          取消
        </button>
      </div>
    </div>
  )
}

interface ReorderPanelProps {
  trip: Trip
  day: DayPlan
}

/** 手动重排面板：仅当存在会话且会话属于当天时渲染。 */
export function ReorderPanel({ trip, day }: ReorderPanelProps) {
  const session = useTripStore((state) => state.reorderSession)
  const openReorderCard = useTripStore((state) => state.openReorderCard)
  const exitReorder = useTripStore((state) => state.exitReorder)
  const timeZone = trip.timezone

  if (session === null || session.dayKey !== day.date) return null

  const total = session.pendingPlaceIds.length
  const processed = session.processedPlaceIds.length
  // 待选卡按当前行程数据解析：被普通编辑删除的地点自然消失（防御）
  const pendingLegs = remainingPendingIds(session)
    .map((id) => day.legs.find((leg) => leg.place.id === id))
    .filter((leg): leg is Leg => leg !== undefined)
  const predecessor = resolveSessionPredecessor(trip, session)

  return (
    <section className="reorder-panel" aria-label="手动重排待选卡槽">
      <div className="reorder-head">
        <strong className="reorder-title">
          手动重排 · 已处理 {processed}/{total}
        </strong>
        <button type="button" className="btn" onClick={exitReorder}>
          退出手动重排
        </button>
      </div>
      <p className="reorder-note">
        逐张点开卡片，填写新的开始时间和到达交通时长，保存立即生效；
        固定时间、已结束和正在进行的行程已锁定，不在卡槽中。
      </p>
      {pendingLegs.length === 0 ? (
        <p className="reorder-note">待选地点已全部处理，可以退出手动重排。</p>
      ) : (
        <div className="reorder-cards">
          {pendingLegs.map((leg) => {
            const index = day.legs.findIndex((entry) => entry.place.id === leg.place.id)
            const prevPlace = index > 0 ? day.legs[index - 1].place : null
            const isCurrent = session.currentPlaceId === leg.place.id
            return (
              <article
                key={leg.place.id}
                className={isCurrent ? 'reorder-card is-open' : 'reorder-card'}
              >
                {isCurrent ? (
                  <ReorderCardForm
                    day={day}
                    leg={leg}
                    prevPlace={prevPlace}
                    predecessorName={predecessor?.name ?? null}
                    timeZone={timeZone}
                  />
                ) : (
                  <button
                    type="button"
                    className="reorder-card-btn"
                    aria-expanded={false}
                    aria-label={`选择 ${leg.place.name} 进行重排`}
                    onClick={() => openReorderCard(leg.place.id)}
                  >
                    <CardReference leg={leg} prevPlace={prevPlace} timeZone={timeZone} />
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
