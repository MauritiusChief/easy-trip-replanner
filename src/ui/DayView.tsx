import { useMemo, useState } from 'react'
import { MS_PER_MINUTE } from '../domain/config'
import type { CurrentPosition } from '../domain/current'
import { getTripDayWindow } from '../domain/current'
import { collectDayWarnings } from '../domain/warnings'
import {
  dayKeyToLabel,
  dayKeyToWeekdayLabel,
  formatMinuteOfDay,
  formatZonedTime,
} from '../domain/time'
import type { DateISO, DayPlan, EpochMs, Leg, Trip } from '../domain/types'
import { useTripStore } from '../state/tripStore'
import { ReorderPanel } from './ReorderPanel'
import './DayView.css'

/**
 * 日卡片内的一行渲染单元。
 * gap 行不是存储数据，而是由相邻 slot 之间的缝隙推导出来的展示元素。
 */
type Row =
  | { kind: 'gap'; key: string; startUtc: EpochMs; endUtc: EpochMs }
  | { kind: 'transport'; key: string; legIndex: number }
  | { kind: 'place'; key: string; legIndex: number }

interface DayViewProps {
  trip: Trip
  day: DayPlan
  /** 当前时间（可能已被调试面板虚构），用于空档"此刻"高亮。 */
  now: EpochMs
  /** 今天对应的日期键（同样跟随虚构时间），用于"今天"徽标。 */
  todayKey: DateISO
  position: CurrentPosition
}

/**
 * 把一天的行程段展开为渲染行，并在缝隙处插入空档行：
 * - 有交通的行程段：若交通晚于前序结束时间 → 先插空档，再渲染交通
 * - 停留开始晚于交通到达（固定锚点前的集合缓冲）→ 再插一段空档
 * - 窗口末尾未排满 → 追加尾部空档
 * cursor 始终指向"已渲染行程的结束时刻"。
 */
function buildRows(day: DayPlan, startUtc: EpochMs, endUtc: EpochMs): Row[] {
  const rows: Row[] = []
  let cursor = startUtc
  day.legs.forEach((leg, legIndex) => {
    if (leg.transport) {
      if (leg.transport.start > cursor) {
        rows.push({ kind: 'gap', key: `gap-t-${legIndex}`, startUtc: cursor, endUtc: leg.transport.start })
      }
      rows.push({ kind: 'transport', key: `transport-${legIndex}`, legIndex })
      cursor = leg.transport.start + leg.transport.durationMinutes * MS_PER_MINUTE
    }
    if (leg.place.start > cursor) {
      rows.push({ kind: 'gap', key: `gap-p-${legIndex}`, startUtc: cursor, endUtc: leg.place.start })
    }
    rows.push({ kind: 'place', key: `place-${legIndex}`, legIndex })
    cursor = Math.max(cursor, leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE)
  })
  if (cursor < endUtc) {
    rows.push({ kind: 'gap', key: 'gap-end', startUtc: cursor, endUtc })
  }
  return rows
}

/**
 * 停留约束摘要：按 min/max 的组合生成可读文本。
 * min 为 null 的可取消地点不在此显示（由"可取消"徽标单独表达）。
 */
function stayLabel(minStay: number | null, maxStay: number | null): string | null {
  if (minStay !== null && maxStay !== null) return `停留 ${minStay}–${maxStay} 分钟`
  if (minStay !== null) return `停留 ≥${minStay} 分钟`
  if (maxStay !== null) return `停留 ≤${maxStay} 分钟`
  return null
}

/** 地点行下方的规划属性徽标：优先级、固定锚点、可取消、开放时间、停留约束。 */
function PlaceMeta({ leg, conflict }: { leg: Leg; conflict: boolean }) {
  const { open, close, minStayMinutes, maxStayMinutes, fixedStart, priority } = leg.place
  const stay = stayLabel(minStayMinutes, maxStayMinutes)
  return (
    <div className="slot-meta">
      <span className="chip">优先级 {priority}</span>
      {fixedStart !== null && (
        <span className="chip chip-fixed">固定 {formatMinuteOfDay(fixedStart)} 开始</span>
      )}
      {minStayMinutes === null && <span className="chip chip-cancellable">可取消</span>}
      {open !== null && close !== null && (
        <span className="chip">
          开放 {formatMinuteOfDay(open)}–{formatMinuteOfDay(close)}
        </span>
      )}
      {stay !== null && <span className="chip">{stay}</span>}
      {conflict && <span className="chip chip-overlap">⚠ 时间重叠</span>}
    </div>
  )
}

/**
 * 单日行程卡片：
 * - 地点/交通行可点击进入对应编辑表单（需求 8.2）
 * - 卡片头部显示警告徽标（可展开明细）与"备选库"入口（需求 7），
 *   库以堆叠卡片形式展示，不是时间轴
 * - 底部提供"添加地点"与"开始手动重排"入口（需求 8.3），
 *   手动重排的待选卡槽与即时保存在 ReorderPanel 中
 */
export function DayView({ trip, day, now, todayKey, position }: DayViewProps) {
  const timeZone = trip.timezone
  const openEditor = useTripStore((state) => state.openEditor)
  const insertPlace = useTripStore((state) => state.insertPlace)
  const startReorder = useTripStore((state) => state.startReorder)
  const [showWarnings, setShowWarnings] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const { startUtc, endUtc } = getTripDayWindow(trip, day.date)
  const rows = buildRows(day, startUtc, endUtc)
  const warnings = useMemo(() => collectDayWarnings(trip, day), [trip, day])
  // 时间重叠涉及的行程段：给对应 slot 加警告样式（冲突状态，配"⚠ 时间重叠"徽标）
  const overlapLegs = useMemo(
    () =>
      new Set(
        warnings
          .filter((warning) => warning.kind === 'overlap' && warning.legIndex !== undefined)
          .map((warning) => warning.legIndex),
      ),
    [warnings],
  )
  const isToday = day.date === todayKey
  // position 只在 place/transport 分支携带 legIndex，先收窄再比较
  const active =
    position.kind === 'place' || position.kind === 'transport'
      ? { kind: position.kind, legIndex: position.legIndex, dayKey: position.dayKey }
      : null
  return (
    <section className={isToday ? 'day-card is-today' : 'day-card'}>
      <div className="day-head">
        <h2 className="day-title">
          {dayKeyToLabel(day.date)}（{dayKeyToWeekdayLabel(day.date)}）
        </h2>
        {isToday && <span className="badge-today">今天</span>}
        {warnings.length > 0 && (
          <button
            type="button"
            className="warn-badge"
            onClick={() => setShowWarnings((visible) => !visible)}
          >
            ⚠ {warnings.length} 项提示
          </button>
        )}
        <button
          type="button"
          className={libraryOpen ? 'lib-badge is-open' : 'lib-badge'}
          onClick={() => setLibraryOpen((open) => !open)}
          aria-expanded={libraryOpen}
        >
          备选库 {day.alternatives.length}
        </button>
        <span className="day-window">
          {formatMinuteOfDay(trip.dayOverrides[day.date]?.start ?? trip.dailyStart)}–
          {formatMinuteOfDay(trip.dayOverrides[day.date]?.end ?? trip.dailyEnd)}
        </span>
      </div>
      {libraryOpen && (
        <div className="alt-library">
          <div className="alt-library-head">
            <span>备选地点库</span>
            <button
              type="button"
              className="btn"
              onClick={() =>
                openEditor({ type: 'alternative', dayKey: day.date, altId: null })
              }
            >
              ＋ 添加备选
            </button>
          </div>
          {day.alternatives.length === 0 ? (
            <p className="day-empty">暂无备选地点</p>
          ) : (
            day.alternatives.map((alternative) => {
              const linkedPlace =
                alternative.linkedPlaceId !== null
                  ? day.legs.find((leg) => leg.place.id === alternative.linkedPlaceId)
                      ?.place
                  : undefined
              const stay = stayLabel(
                alternative.minStayMinutes,
                alternative.maxStayMinutes,
              )
              return (
                <button
                  key={alternative.id}
                  type="button"
                  className="alt-card"
                  aria-label={`编辑备选 ${alternative.name}`}
                  onClick={() =>
                    openEditor({
                      type: 'alternative',
                      dayKey: day.date,
                      altId: alternative.id,
                    })
                  }
                >
                  <div className="slot-top">
                    <span>{alternative.name}</span>
                    <span
                      className={linkedPlace ? 'chip chip-link' : 'chip chip-unlinked'}
                    >
                      {linkedPlace ? `备用于 ${linkedPlace.name}` : '未连接'}
                    </span>
                  </div>
                  <div className="slot-meta">
                    <span className="chip">优先级 {alternative.priority}</span>
                    <span className="chip">停留 {alternative.durationMinutes} 分钟</span>
                    {alternative.fixedStart !== null && (
                      <span className="chip chip-fixed">
                        固定 {formatMinuteOfDay(alternative.fixedStart)} 开始
                      </span>
                    )}
                    {alternative.minStayMinutes === null && (
                      <span className="chip chip-cancellable">可取消</span>
                    )}
                    {alternative.open !== null && alternative.close !== null && (
                      <span className="chip">
                        开放 {formatMinuteOfDay(alternative.open)}–
                        {formatMinuteOfDay(alternative.close)}
                      </span>
                    )}
                    {stay !== null && <span className="chip">{stay}</span>}
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}
      {showWarnings && warnings.length > 0 && (
        <ul className="warn-list">
          {warnings.map((warning, index) => (
            <li key={`${warning.kind}-${warning.legIndex}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      )}
      {day.legs.length === 0 ? (
        <p className="day-empty">当日暂无安排</p>
      ) : (
        <div className="slot-list">
          {rows.map((row) => {
            if (row.kind === 'gap') {
              // 空档行的"此刻"高亮：直接用时间区间判断 now 是否落在其中
              const isCurrentGap =
                position.kind === 'gap' &&
                position.dayKey === day.date &&
                row.startUtc <= now &&
                now < row.endUtc
              return (
                <div
                  key={row.key}
                  className={isCurrentGap ? 'slot slot-gap is-current' : 'slot slot-gap'}
                >
                  <span className="slot-time">
                    {formatZonedTime(row.startUtc, timeZone)}–
                    {formatZonedTime(row.endUtc, timeZone)}
                  </span>
                  <span>空档</span>
                </div>
              )
            }
            const leg = day.legs[row.legIndex]
            const isCurrent =
              active !== null &&
              active.dayKey === day.date &&
              active.kind === row.kind &&
              active.legIndex === row.legIndex
            const conflict = overlapLegs.has(row.legIndex)
            const className = `slot slot-${row.kind}${isCurrent ? ' is-current' : ''}${
              conflict ? ' is-conflict' : ''
            }`
            if (row.kind === 'transport') {
              const transport = leg.transport
              if (!transport) return null
              const endUtc = transport.start + transport.durationMinutes * MS_PER_MINUTE
              return (
                <button
                  key={row.key}
                  type="button"
                  className={className}
                  aria-label={`编辑前往 ${leg.place.name} 的交通`}
                  onClick={() =>
                    openEditor({ type: 'transport', dayKey: day.date, legIndex: row.legIndex })
                  }
                >
                  <div className="slot-top">
                    <span>交通 · 前往 {leg.place.name}</span>
                    <span className="slot-time">
                      {formatZonedTime(transport.start, timeZone)}–
                      {formatZonedTime(endUtc, timeZone)}
                    </span>
                  </div>
                  <div className="slot-meta">
                    <span className="chip">{transport.durationMinutes} 分钟</span>
                    {transport.baseSpeedKmh !== null && (
                      <span className="chip">约 {transport.baseSpeedKmh} km/h</span>
                    )}
                    {conflict && <span className="chip chip-overlap">⚠ 时间重叠</span>}
                  </div>
                </button>
              )
            }
            const placeEnd = leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
            return (
              <button
                key={row.key}
                type="button"
                className={className}
                aria-label={`编辑 ${leg.place.name}`}
                onClick={() =>
                  openEditor({ type: 'place', dayKey: day.date, legIndex: row.legIndex })
                }
              >
                <div className="slot-top">
                  <span>{leg.place.name}</span>
                  <span className="slot-time">
                    {formatZonedTime(leg.place.start, timeZone)}–
                    {formatZonedTime(placeEnd, timeZone)}
                  </span>
                </div>
                <PlaceMeta leg={leg} conflict={conflict} />
              </button>
            )
          })}
        </div>
      )}
      <ReorderPanel trip={trip} day={day} />
      <div className="day-actions">
        <button type="button" className="btn" onClick={() => insertPlace(day.date, null)}>
          ＋ 添加地点
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => startReorder(day.date, now)}
        >
          开始手动重排
        </button>
      </div>
    </section>
  )
}
