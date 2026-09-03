import { useMemo, useState } from 'react'
import { MS_PER_MINUTE } from '../domain/config'
import {
  buildDraftDiff,
  countDraftChanges,
  type DraftDiffItem,
} from '../domain/draftDiff'
import { formatZonedTime } from '../domain/time'
import type { DayPlan, EpochMs, Leg, ReplanDraft, Trip } from '../domain/types'
import { useTripStore } from '../state/tripStore'
import './DraftCompare.css'

interface DraftCompareProps {
  trip: Trip
  day: DayPlan
  draft: ReplanDraft
  /** 当前时刻（可能被调试面板虚构），逐项采纳后重建草案时沿用。 */
  now: EpochMs
  /** "返回编辑"：收起对比视图，草案保留在 store 中可再次打开。 */
  onCollapse: () => void
}

/** 段落的显示时间段 "HH:mm–HH:mm"（旅行时区）。 */
function formatRange(leg: Leg, timeZone: string): string {
  const end = leg.place.start + leg.place.durationMinutes * MS_PER_MINUTE
  return `${formatZonedTime(leg.place.start, timeZone)}–${formatZonedTime(end, timeZone)}`
}

/** 变更条目的类型徽标文案（changed 按具体变化点细分）。 */
function kindChips(item: DraftDiffItem): { label: string; kind: string }[] {
  if (item.kind === 'cancelled') return [{ label: '取消', kind: 'cancel' }]
  if (item.kind === 'replaced') return [{ label: '备选替换', kind: 'replace' }]
  if (item.kind === 'unchanged') return []
  const chips: { label: string; kind: string }[] = []
  if (item.orderChanged) chips.push({ label: '顺序调整', kind: 'order' })
  if (item.startChanged) chips.push({ label: '时间调整', kind: 'order' })
  if (item.durationChanged) chips.push({ label: '停留调整', kind: 'stay' })
  if (item.transportChanged) chips.push({ label: '交通起点变化', kind: 'order' })
  return chips.length > 0
    ? chips
    : [{ label: '调整', kind: 'order' }]
}

/**
 * 单个变更条目：类型徽标 + 名称 + 原计划 → 草案对比 + 归属警告 + 采纳按钮。
 * 数据（时间、停留、警告原因）全部来自 draftDiff 的结构化结果。
 */
function DiffItemRow({
  item,
  timeZone,
  onApply,
}: {
  item: DraftDiffItem
  timeZone: string
  onApply: (item: DraftDiffItem) => void
}) {
  const original = item.originalLeg
  const next = item.draftLeg
  const name =
    item.kind === 'replaced' && original !== null && next !== null
      ? `${original.place.name} → ${next.place.name}`
      : (original ?? next)?.place.name ?? ''
  const showDraftTimes = next !== null && item.kind !== 'cancelled'
  const applyLabel =
    item.kind === 'cancelled'
      ? `确认取消 ${name}`
      : `采纳「${name}」的草案安排`
  return (
    <li className="diff-item">
      <div className="diff-item-top">
        <span className="diff-item-title">{name}</span>
        <span className="diff-chips">
          {kindChips(item).map((chip) => (
            <span key={chip.label} className={`chip chip-diff-${chip.kind}`}>
              {chip.label}
            </span>
          ))}
        </span>
      </div>
      <div className="diff-times">
        {original !== null && (
          <span className="diff-times-original">
            原 {formatRange(original, timeZone)}
          </span>
        )}
        {showDraftTimes && (
          <span className="diff-times-draft">
            {original !== null ? '草案 ' : ''}
            {formatRange(next, timeZone)}
          </span>
        )}
        {item.durationChanged && original !== null && next !== null && (
          <span className="chip">
            停留 {original.place.durationMinutes} → {next.place.durationMinutes} 分钟
          </span>
        )}
      </div>
      {item.warnings.length > 0 && (
        <ul className="warn-list diff-warnings">
          {item.warnings.map((warning, index) => (
            <li key={`${warning.kind}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      )}
      <div className="diff-item-actions">
        <button
          type="button"
          className={item.kind === 'cancelled' ? 'btn btn-danger' : 'btn btn-accent'}
          aria-label={applyLabel}
          onClick={() => onApply(item)}
        >
          {item.kind === 'cancelled' ? '确认取消' : '采纳此项'}
        </button>
      </div>
    </li>
  )
}

/**
 * 草案对比视图（阶段 4）：
 * - 逐条展示原计划与草案的差异（顺序/时间/停留/交通/取消/备选替换）
 * - 每条可单独采纳（逐条即时应用：写入计划后按原参数重建草案）
 * - 也可整份采纳或放弃；未确认的草案绝不写入正式计划（需求 1.2）
 * - "返回编辑"收起本视图但草案保留，可从日卡片的横幅重新进入
 */
export function DraftCompare({
  trip,
  day,
  draft,
  now,
  onCollapse,
}: DraftCompareProps) {
  const timeZone = trip.timezone
  const applyDraftItem = useTripStore((state) => state.applyDraftItem)
  const adoptDraft = useTripStore((state) => state.adoptDraft)
  const discardDraft = useTripStore((state) => state.discardDraft)
  const [announce, setAnnounce] = useState('')

  const diff = useMemo(() => buildDraftDiff(trip, draft), [trip, draft])
  const changedItems = diff.items.filter((item) => item.kind !== 'unchanged')
  const unchangedItems = diff.items.filter((item) => item.kind === 'unchanged')
  const stats = `${changedItems.length} 项变更 · 取消 ${
    changedItems.filter((item) => item.kind === 'cancelled').length
  } 项 · 备选替换 ${changedItems.filter((item) => item.kind === 'replaced').length} 项`

  const handleApply = (item: DraftDiffItem) => {
    const name = (item.originalLeg ?? item.draftLeg)?.place.name ?? ''
    applyDraftItem(item, now)
    const remaining = countDraftChanges(diff) - 1
    setAnnounce(
      remaining > 0
        ? `已采纳「${name}」，剩余 ${remaining} 项变更`
        : `已采纳「${name}」，草案处理完毕`,
    )
  }

  return (
    <div className="draft-compare">
      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="day-head">
        <strong className="draft-title">重排草案对比</strong>
        <span className="day-window">{stats}</span>
        <button type="button" className="btn" onClick={onCollapse}>
          返回编辑
        </button>
      </div>
      {draft.infeasibleReasons.length > 0 && (
        <div>
          <p className="diff-section-label">无法满足的约束</p>
          <ul className="warn-list">
            {draft.infeasibleReasons.map((reason, index) => (
              <li key={`reason-${index}`}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {changedItems.length === 0 ? (
        <p className="day-empty">草案与当前计划一致，可返回编辑或放弃草案</p>
      ) : (
        <ol className="diff-list">
          {changedItems.map((item) => (
            <DiffItemRow
              key={item.key}
              item={item}
              timeZone={timeZone}
              onApply={handleApply}
            />
          ))}
        </ol>
      )}
      {unchangedItems.length > 0 && (
        <p className="day-empty">
          其余 {unchangedItems.length} 项保持不变：
          {unchangedItems.map((item) => item.originalLeg?.place.name).join('、')}
        </p>
      )}
      {diff.globalWarnings.length > 0 && (
        <div>
          <p className="diff-section-label">其他提示</p>
          <ul className="warn-list">
            {diff.globalWarnings.map((warning, index) => (
              <li key={`${warning.kind}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="day-actions">
        <button type="button" className="btn btn-accent" onClick={adoptDraft}>
          整份采纳
        </button>
        <button type="button" className="btn" onClick={discardDraft}>
          放弃草案
        </button>
      </div>
      <p className="day-empty">
        逐项采纳会立即修改当天计划并刷新剩余草案；整份采纳一次性替换 {day.date} 的剩余行程
      </p>
    </div>
  )
}
