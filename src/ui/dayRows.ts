import { MS_PER_MINUTE } from '../domain/config'
import type { DayPlan, EpochMs } from '../domain/types'

/** 卡片显示高度的时间粒度，仅影响视图，不修改行程数据。 */
export const SLOT_HEIGHT_STEP_MINUTES = 15

/** 日卡片内的一行渲染单元；gap 是由相邻 slot 之间的缝隙推导出来的展示元素。 */
export type DayRow =
  | { kind: 'gap'; key: string; startUtc: EpochMs; endUtc: EpochMs }
  | { kind: 'transport'; key: string; legIndex: number }
  | { kind: 'place'; key: string; legIndex: number }

/** 把时长向上取整到卡片显示高度所用的 15 分钟步数。 */
export function getSlotHeightSteps(durationMinutes: number): number {
  return Math.ceil(durationMinutes / SLOT_HEIGHT_STEP_MINUTES)
}

/**
 * 把一天的行程段展开为渲染行，并在缝隙处插入空档行。
 * 空白日期会生成一张覆盖整个日窗口的空档卡片。
 */
export function buildDayRows(
  day: Pick<DayPlan, 'legs'>,
  startUtc: EpochMs,
  endUtc: EpochMs,
): DayRow[] {
  const rows: DayRow[] = []
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
