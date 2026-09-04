import { create } from 'zustand'
import { loadTrip, saveTrip } from '../data/storage'
import {
  withAlternativeDeleted,
  withAlternativeSaved,
  withPlaceDeleted,
  withPlaceInserted,
  withPlaceSaved,
  withTransportDeleted,
  withTransportDuration,
  withTransportInserted,
  withTripSettingsSaved,
} from '../domain/mutations'
import {
  resolveSessionPredecessor,
  startManualReorderSession,
  withCurrentCard,
  withManualReorderSaved,
  withPlaceProcessed,
} from '../domain/manualReorder'
import type {
  AlternativePlace,
  DateISO,
  EpochMs,
  PlaceId,
  PlaceSlot,
  Trip,
} from '../domain/types'
import type {
  ManualReorderSave,
  ManualReorderSession,
} from '../domain/manualReorder'
import type { TripSettings } from '../domain/mutations'

/**
 * 全局状态：
 * - trip：唯一主要状态，任何变更经 mutations 纯函数生成新引用并自动持久化
 * - editor：当前打开的编辑器（临时 UI 状态，不持久化）
 * - reorderSession：手动重排会话（仅内存，不持久化；
 *   退出仅关闭 UI，已保存的调整已即时写入 trip）
 * - resetReason / saveFailed：数据加载与持久化的用户提示
 */

/** 编辑器目标：行程设置、某天的某个地点/交通段，或备选库条目（altId 为 null 表示新建）。 */
export type EditorSelection =
  | { type: 'trip' }
  | { type: 'place'; dayKey: DateISO; legIndex: number }
  | { type: 'transport'; dayKey: DateISO; legIndex: number }
  | { type: 'alternative'; dayKey: DateISO; altId: PlaceId | null }

export interface TripStore {
  trip: Trip
  resetReason: string | null
  saveFailed: boolean
  editor: EditorSelection | null
  /**
   * 手动重排会话（仅内存，不持久化）：
   * null 表示未在进行手动重排；会话只属于启动时的那一天。
   */
  reorderSession: ManualReorderSession | null
  openEditor: (selection: EditorSelection) => void
  closeEditor: () => void
  /** 用已校验的完整行程替换当前数据，并清理关联旧行程的临时 UI 状态。 */
  replaceTrip: (trip: Trip) => void
  /** 保存行程级设置（名称/时区/日期范围/每日窗口），保存后关闭编辑器。 */
  saveTripSettings: (settings: TripSettings) => void
  /** 保存地点编辑，保存后关闭编辑器。 */
  savePlaceEdit: (dayKey: DateISO, legIndex: number, place: PlaceSlot) => void
  /** 保存交通时长编辑（基准速度按新时长重算），保存后关闭编辑器。 */
  saveTransportEdit: (
    dayKey: DateISO,
    legIndex: number,
    durationMinutes: number,
  ) => void
  /** 为一个非首段且缺少交通的地点补建默认到达交通。 */
  insertTransport: (dayKey: DateISO, legIndex: number) => void
  /** 删除地点的到达交通。 */
  deleteTransport: (dayKey: DateISO, legIndex: number) => void
  /** 保存备选库条目（新建或编辑，按 id upsert），保存后关闭编辑器。 */
  saveAlternative: (dayKey: DateISO, alternative: AlternativePlace) => void
  /** 删除备选库条目。 */
  deleteAlternative: (dayKey: DateISO, altId: PlaceId) => void
  /** 插入新地点：afterLegIndex 为 null 追加到当天末尾。 */
  insertPlace: (dayKey: DateISO, afterLegIndex: number | null) => void
  /** 删除地点。 */
  deletePlace: (dayKey: DateISO, legIndex: number) => void
  /** 开始手动重排：为指定日期构建会话（当天没有待选地点时不开启）。 */
  startReorder: (dayKey: DateISO, now: EpochMs) => void
  /** 打开一张待选卡的输入界面。 */
  openReorderCard: (placeId: PlaceId) => void
  /** 关闭当前卡的输入界面（不退出会话）。 */
  closeReorderCard: () => void
  /** 保存当前卡：原子写入正式行程并标记已处理，时间轴与警告即时刷新。 */
  saveReorderCard: (save: ManualReorderSave) => void
  /** 退出手动重排：仅关闭会话 UI，已保存的变更不回滚。 */
  exitReorder: () => void
}

const initial = loadTrip()

export const useTripStore = create<TripStore>()((set) => ({
  trip: initial.trip,
  resetReason: initial.resetReason,
  saveFailed: false,
  editor: null,
  reorderSession: null,
  openEditor: (selection) => set({ editor: selection }),
  closeEditor: () => set({ editor: null }),
  replaceTrip: (trip) =>
    set({
      trip,
      editor: null,
      reorderSession: null,
      resetReason: null,
      saveFailed: false,
    }),
  saveTripSettings: (settings) =>
    set((state) => ({
      trip: withTripSettingsSaved(state.trip, settings),
      editor: null,
    })),
  savePlaceEdit: (dayKey, legIndex, place) =>
    set((state) => ({
      trip: withPlaceSaved(state.trip, dayKey, legIndex, place),
      editor: null,
    })),
  saveTransportEdit: (dayKey, legIndex, durationMinutes) =>
    set((state) => ({
      trip: withTransportDuration(state.trip, dayKey, legIndex, durationMinutes),
      editor: null,
    })),
  insertTransport: (dayKey, legIndex) =>
    set((state) => ({
      trip: withTransportInserted(state.trip, dayKey, legIndex),
      editor: null,
    })),
  deleteTransport: (dayKey, legIndex) =>
    set((state) => ({
      trip: withTransportDeleted(state.trip, dayKey, legIndex),
      editor: null,
    })),
  saveAlternative: (dayKey, alternative) =>
    set((state) => ({
      trip: withAlternativeSaved(state.trip, dayKey, alternative),
      editor: null,
    })),
  deleteAlternative: (dayKey, altId) =>
    set((state) => ({
      trip: withAlternativeDeleted(state.trip, dayKey, altId),
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
  startReorder: (dayKey, now) =>
    set((state) => ({
      // 会话全局只保留一份：在其他日期再次开始会替换旧会话
      reorderSession: startManualReorderSession(state.trip, dayKey, now),
    })),
  openReorderCard: (placeId) =>
    set((state) => ({
      reorderSession: state.reorderSession
        ? withCurrentCard(state.reorderSession, placeId)
        : null,
    })),
  closeReorderCard: () =>
    set((state) => ({
      reorderSession: state.reorderSession
        ? withCurrentCard(state.reorderSession, null)
        : null,
    })),
  saveReorderCard: (save) =>
    set((state) => {
      const session = state.reorderSession
      if (!session) return {}
      const predecessor = resolveSessionPredecessor(state.trip, session)
      return {
        trip: withManualReorderSaved(state.trip, session.dayKey, save, predecessor),
        reorderSession: withPlaceProcessed(session, save.placeId),
      }
    }),
  exitReorder: () => set({ reorderSession: null }),
}))

// 自动持久化：trip 引用变化即写盘（需求 10.1 客户端存储）。
// 写失败（配额/隐私模式）只记录提示，不阻断编辑。
useTripStore.subscribe((state, prevState) => {
  if (state.trip === prevState.trip) return
  if (!saveTrip(state.trip)) useTripStore.setState({ saveFailed: true })
})

// 首次打开或数据被重置为空行程时立即落盘，保证后续刷新直接进入"storage"路径。
if (initial.source === 'empty') {
  if (!saveTrip(initial.trip)) useTripStore.setState({ saveFailed: true })
}
