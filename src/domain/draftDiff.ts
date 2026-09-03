import type {
  AlternativePlace,
  Leg,
  PlaceId,
  PlanWarning,
  ReplanDraft,
  Trip,
} from './types'

/**
 * 草案对比（阶段 4 核心）：把"原计划剩余段"（day.legs.slice(fromLegIndex)）
 * 与草案 legs 按地点 id 配对，产出结构化变更条目，供对比视图逐项展示与采纳。
 *
 * 配对规则：
 * - 同 id 同时出现在两侧 → changed / unchanged（按具体变化点细分）
 * - 原 id 只出现在 cancelledPlaceIds → cancelled；若草案中存在"链接指向它"
 *   的备选换入段（id 为备选自身 id，可经日级备选库的 linkedPlaceId 追溯），
 *   则为 replaced（原地点 → 备选）
 * - 草案中无法追溯到原地点的段（防御分支）也按 replaced 呈现，不丢数据
 *
 * 条目顺序沿用原计划的时间顺序：取消/替换/调整都出现在原位置附近，
 * 纯换入段（无原地点）追加在末尾。
 */

export type DraftItemKind = 'cancelled' | 'replaced' | 'changed' | 'unchanged'

export interface DraftDiffItem {
  /** 渲染 key：优先草案 id，取消项用原 id。 */
  key: string
  kind: DraftItemKind
  /** 草案 legs 中的下标；cancelled 为 null。 */
  draftIndex: number | null
  /** 原计划剩余区（slice(fromLegIndex)）中的下标；纯换入段为 null。 */
  originalIndex: number | null
  originalLeg: Leg | null
  draftLeg: Leg | null
  /** 开始时间变化（含因顺序重排导致的位置变化）。 */
  startChanged: boolean
  /** 停留时长变化（压缩或延长）。 */
  durationChanged: boolean
  /** 相对顺序与原计划不同。 */
  orderChanged: boolean
  /** 到达交通的出发地变化（前序地点改变的副作用，需求 4.4）。 */
  transportChanged: boolean
  /** 归属到本条目的草案警告（取消/替换/压缩/速度异常等）。 */
  warnings: PlanWarning[]
}

export interface DraftDiff {
  items: DraftDiffItem[]
  /** 无法归属到具体条目的警告（含锁定前缀上的通用警告，后者通常已在日卡片展示）。 */
  globalWarnings: PlanWarning[]
}

/** 段落的结束时刻（停留结束）。 */
function transportChangedBetween(before: Leg, after: Leg): boolean {
  if (!before.transport && !after.transport) return false
  if (!before.transport || !after.transport) return true
  return (
    before.transport.from.lat !== after.transport.from.lat ||
    before.transport.from.lng !== after.transport.from.lng
  )
}

/** 同 id 配对时的具体变化点分析。 */
function diffMatchedLegs(
  original: Leg,
  draft: Leg,
  orderChanged: boolean,
): Pick<
  DraftDiffItem,
  'startChanged' | 'durationChanged' | 'orderChanged' | 'transportChanged'
> {
  return {
    startChanged: original.place.start !== draft.place.start,
    durationChanged:
      original.place.durationMinutes !== draft.place.durationMinutes,
    orderChanged,
    transportChanged: transportChangedBetween(original, draft),
  }
}

/**
 * 生成草案与原计划的对比结果。纯函数：随 trip/draft 引用变化由界面 useMemo 缓存。
 */
export function buildDraftDiff(trip: Trip, draft: ReplanDraft): DraftDiff {
  const day = trip.days.find((entry) => entry.date === draft.day)
  // "无可排内容"的失败草案（legs 与 cancelled 均为空，仅带原因）：
  // 没有可配对的行程段，原计划不应被误判为整日取消
  if (!day || (draft.legs.length === 0 && draft.cancelledPlaceIds.length === 0)) {
    return { items: [], globalWarnings: draft.warnings }
  }

  const originals = day.legs.slice(draft.fromLegIndex)
  const draftLegs = draft.legs

  // 备选换入段：通过日级备选库的 linkedPlaceId 追溯被替换的原地点
  const altById = new Map<PlaceId, AlternativePlace>(
    day.alternatives.map((entry) => [entry.id, entry]),
  )
  // 原计划顺序与草案顺序的序号表，用于判断顺序变化
  const originalOrder = new Map<PlaceId, number>(
    originals.map((leg, index) => [leg.place.id, index]),
  )
  const draftOrder = new Map<PlaceId, number>(
    draftLegs.map((leg, index) => [leg.place.id, index]),
  )

  const items: DraftDiffItem[] = []
  const claimedDraft = new Set<number>()

  originals.forEach((originalLeg, originalIndex) => {
    const id = originalLeg.place.id
    const draftIndex = draftLegs.findIndex((leg) => leg.place.id === id)
    if (draftIndex >= 0) {
      claimedDraft.add(draftIndex)
      const draftLeg = draftLegs[draftIndex]
      const flags = diffMatchedLegs(
        originalLeg,
        draftLeg,
        (originalOrder.get(id) ?? -1) !== (draftOrder.get(id) ?? -1),
      )
      const changed = Object.values(flags).some(Boolean)
      items.push({
        key: id,
        kind: changed ? 'changed' : 'unchanged',
        draftIndex,
        originalIndex,
        originalLeg,
        draftLeg,
        warnings: [],
        ...flags,
      })
      return
    }
    // 原地点不在草案中：查看是否有链接指向它的备选被换入
    const altDraftIndex = draftLegs.findIndex((leg) => {
      const alt = altById.get(leg.place.id)
      return alt !== undefined && alt.linkedPlaceId === id
    })
    if (altDraftIndex >= 0) {
      claimedDraft.add(altDraftIndex)
      const draftLeg = draftLegs[altDraftIndex]
      items.push({
        key: `replaced-${id}`,
        kind: 'replaced',
        draftIndex: altDraftIndex,
        originalIndex,
        originalLeg,
        draftLeg,
        startChanged: originalLeg.place.start !== draftLeg.place.start,
        durationChanged:
          originalLeg.place.durationMinutes !== draftLeg.place.durationMinutes,
        orderChanged: false,
        transportChanged: transportChangedBetween(originalLeg, draftLeg),
        warnings: [],
      })
      return
    }
    items.push({
      key: `cancelled-${id}`,
      kind: 'cancelled',
      draftIndex: null,
      originalIndex,
      originalLeg,
      draftLeg: null,
      startChanged: false,
      durationChanged: false,
      orderChanged: false,
      transportChanged: false,
      warnings: [],
    })
  })

  // 防御分支：草案中的段既不是原地点、也追溯不到被替换的原地点
  draftLegs.forEach((draftLeg, draftIndex) => {
    if (claimedDraft.has(draftIndex)) return
    items.push({
      key: `inserted-${draftLeg.place.id}`,
      kind: 'replaced',
      draftIndex,
      originalIndex: null,
      originalLeg: null,
      draftLeg,
      startChanged: true,
      durationChanged: false,
      orderChanged: false,
      transportChanged: false,
      warnings: [],
    })
  })

  // 警告归属：placeId 优先（引擎提示），其次 legIndex（换算为草案下标）。
  // 锁定前缀上的通用警告已在日卡片的警告徽标中展示，不再重复进入对比视图。
  const globalWarnings: PlanWarning[] = []
  for (const warning of draft.warnings) {
    let target: DraftDiffItem | undefined
    if (warning.placeId !== undefined) {
      target = items.find(
        (item) =>
          item.originalLeg?.place.id === warning.placeId ||
          item.draftLeg?.place.id === warning.placeId,
      )
    } else if (
      warning.legIndex !== undefined &&
      warning.legIndex >= draft.fromLegIndex
    ) {
      const draftIndex = warning.legIndex - draft.fromLegIndex
      target = items.find((item) => item.draftIndex === draftIndex)
    } else if (warning.legIndex !== undefined) {
      continue
    }
    if (target) target.warnings.push(warning)
    else globalWarnings.push(warning)
  }

  return { items, globalWarnings }
}

/** 变更条目数（对比视图摘要与"是否还有实质变化"判断使用）。 */
export function countDraftChanges(diff: DraftDiff): number {
  return diff.items.filter((item) => item.kind !== 'unchanged').length
}
