import { create } from 'zustand'
import { loadTrip, saveTrip } from '../data/storage'
import {
  withPlaceDeleted,
  withPlaceInserted,
  withPlaceSaved,
  withTransportDuration,
} from '../domain/mutations'
import type {
  AlternativePlace,
  DateISO,
  PlaceSlot,
  Trip,
} from '../domain/types'

/**
 * 全局状态（阶段 2 引入 zustand 的落地）：
 * - trip：唯一主要状态，任何变更经 mutations 纯函数生成新引用并自动持久化
 * - editor：当前打开的编辑器（临时 UI 状态，不持久化）
 * - resetReason / saveFailed：数据加载与持久化的用户提示
 *
 * 阶段 3 将在此追加 ReplanDraft（非持久化）。
 */

/** 编辑器目标：某天的某个地点或交通段。 */
export type EditorSelection =
  | { type: 'place'; dayKey: DateISO; legIndex: number }
  | { type: 'transport'; dayKey: DateISO; legIndex: number }

export interface TripStore {
  trip: Trip
  resetReason: string | null
  saveFailed: boolean
  editor: EditorSelection | null
  openEditor: (selection: EditorSelection) => void
  closeEditor: () => void
  /** 保存地点编辑（含备选地点），保存后关闭编辑器。 */
  savePlaceEdit: (
    dayKey: DateISO,
    legIndex: number,
    place: PlaceSlot,
    alternatives: AlternativePlace[],
  ) => void
  /** 保存交通时长编辑（基准速度按新时长重算），保存后关闭编辑器。 */
  saveTransportEdit: (
    dayKey: DateISO,
    legIndex: number,
    durationMinutes: number,
  ) => void
  /** 插入新地点：afterLegIndex 为 null 追加到当天末尾。 */
  insertPlace: (dayKey: DateISO, afterLegIndex: number | null) => void
  /** 删除地点。 */
  deletePlace: (dayKey: DateISO, legIndex: number) => void
}

const initial = loadTrip()

export const useTripStore = create<TripStore>()((set) => ({
  trip: initial.trip,
  resetReason: initial.resetReason,
  saveFailed: false,
  editor: null,
  openEditor: (selection) => set({ editor: selection }),
  closeEditor: () => set({ editor: null }),
  savePlaceEdit: (dayKey, legIndex, place, alternatives) =>
    set((state) => ({
      trip: withPlaceSaved(state.trip, dayKey, legIndex, place, alternatives),
      editor: null,
    })),
  saveTransportEdit: (dayKey, legIndex, durationMinutes) =>
    set((state) => ({
      trip: withTransportDuration(state.trip, dayKey, legIndex, durationMinutes),
      editor: null,
    })),
  insertPlace: (dayKey, afterLegIndex) =>
    set((state) => ({
      trip: withPlaceInserted(state.trip, dayKey, afterLegIndex),
      editor: null,
    })),
  deletePlace: (dayKey, legIndex) =>
    set((state) => ({
      trip: withPlaceDeleted(state.trip, dayKey, legIndex),
      editor: null,
    })),
}))

// 自动持久化：trip 引用变化即写盘（需求 10.1 客户端存储）。
// 写失败（配额/隐私模式）只记录提示，不阻断编辑。
useTripStore.subscribe((state, prevState) => {
  if (state.trip === prevState.trip) return
  if (!saveTrip(state.trip)) useTripStore.setState({ saveFailed: true })
})

// 首次打开或数据被重置为示例时立即落盘种子，保证刷新后数据仍在。
if (initial.source === 'sample') {
  if (!saveTrip(initial.trip)) useTripStore.setState({ saveFailed: true })
}
