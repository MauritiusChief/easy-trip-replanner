import { useEffect } from 'react'
import { dayKeyToLabel } from '../../domain/time'
import { findAlternative, findLeg } from '../../domain/current'
import { useTripStore } from '../../state/tripStore'
import { AlternativeEditor } from './AlternativeEditor'
import { PlaceEditor } from './PlaceEditor'
import { TransportEditor } from './TransportEditor'
import './EditorSheet.css'

/**
 * 编辑器容器（需求 8.2）：移动端底部抽屉。
 * - 由 store 的 editor 状态驱动显隐与目标（地点/交通/备选库条目）
 * - 点背景或按 Esc 关闭
 * - 编辑目标失效（行程段或备选条目被删除）时自动关闭
 * 用 key 强制在目标切换时重挂载表单，保证本地状态从当前数据初始化。
 */
export function EditorSheet() {
  const editor = useTripStore((state) => state.editor)
  const trip = useTripStore((state) => state.trip)
  const closeEditor = useTripStore((state) => state.closeEditor)

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

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEditor()
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
      <section className="sheet" role="dialog" aria-label={title}>
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
