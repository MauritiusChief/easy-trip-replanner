import { useEffect, useRef } from 'react'
import { dayKeyToLabel } from '../../domain/time'
import { findAlternative, findLeg } from '../../domain/current'
import { useTripStore } from '../../state/tripStore'
import { AlternativeEditor } from './AlternativeEditor'
import { PlaceEditor } from './PlaceEditor'
import { TransportEditor } from './TransportEditor'
import './EditorSheet.css'

/** 抽屉内可聚焦元素选择器（焦点陷阱用）。 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 编辑器容器（需求 8.2）：移动端底部抽屉。
 * - 由 store 的 editor 状态驱动显隐与目标（地点/交通/备选库条目）
 * - 点背景或按 Esc 关闭；Tab 在抽屉内循环（焦点陷阱），关闭后焦点归还触发元素
 * - 编辑目标失效（行程段或备选条目被删除）时自动关闭
 * 用 key 强制在目标切换时重挂载表单，保证本地状态从当前数据初始化。
 */
export function EditorSheet() {
  const editor = useTripStore((state) => state.editor)
  const trip = useTripStore((state) => state.trip)
  const closeEditor = useTripStore((state) => state.closeEditor)
  const sheetRef = useRef<HTMLElement | null>(null)
  const open = editor !== null

  const leg =
    editor && editor.type !== 'alternative'
      ? findLeg(trip, editor.dayKey, editor.legIndex)
      : undefined
  const alternative =
    editor && editor.type === 'alternative' && editor.altId !== null
      ? findAlternative(trip, editor.dayKey, editor.altId)
      : undefined

  useEffect(() => {
    if (!editor) return
    const invalid =
      (editor.type !== 'alternative' && !leg) ||
      (editor.type === 'alternative' && editor.altId !== null && !alternative)
    if (invalid) closeEditor()
  }, [editor, leg, alternative, closeEditor])

  // 焦点管理（阶段 4 可访问性）：打开时把焦点移入抽屉并记录触发元素，
  // 关闭时归还焦点；Tab 循环限制在抽屉内部，避免焦点落到被遮挡的页面内容上
  useEffect(() => {
    if (!open) return
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = sheetRef.current
    if (node) {
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(focusables[0] ?? node).focus()
    }
    return () => previous?.focus()
  }, [open])

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeEditor()
        return
      }
      if (event.key !== 'Tab') return
      const node = sheetRef.current
      if (!node) return
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor, closeEditor])

  if (!editor) return null
  if (editor.type !== 'alternative' && !leg) return null

  const day = trip.days.find((entry) => entry.date === editor.dayKey)
  const dayLabel = day ? `（${dayKeyToLabel(day.date)}）` : ''
  const title =
    editor.type === 'place'
      ? `编辑地点 · ${leg?.place.name}${dayLabel}`
      : editor.type === 'transport'
        ? `编辑交通 · 前往 ${leg?.place.name}${dayLabel}`
        : editor.altId === null
          ? `新增备选地点${dayLabel}`
          : `编辑备选 · ${alternative?.name ?? ''}${dayLabel}`

  return (
    <>
      <div className="sheet-backdrop" onClick={closeEditor} aria-hidden="true" />
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="sheet-head">
          <strong>{title}</strong>
          <button type="button" className="btn" onClick={closeEditor}>
            关闭
          </button>
        </div>
        {editor.type === 'place' ? (
          <PlaceEditor key={`place-${editor.dayKey}-${editor.legIndex}`} dayKey={editor.dayKey} legIndex={editor.legIndex} />
        ) : editor.type === 'transport' ? (
          <TransportEditor key={`transport-${editor.dayKey}-${editor.legIndex}`} dayKey={editor.dayKey} legIndex={editor.legIndex} />
        ) : (
          <AlternativeEditor
            key={`alt-${editor.dayKey}-${editor.altId ?? 'new'}`}
            dayKey={editor.dayKey}
            altId={editor.altId}
          />
        )}
      </section>
    </>
  )
}
