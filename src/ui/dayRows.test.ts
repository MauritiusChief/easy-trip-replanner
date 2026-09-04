import { describe, expect, it } from 'vitest'
import { MS_PER_MINUTE } from '../domain/config'
import type { DayPlan, PlaceSlot, TransportSlot } from '../domain/types'
import { buildDayRows, getSlotHeightSteps } from './dayRows'

const place: PlaceSlot = {
  id: 'place-1',
  name: '地点',
  location: { lat: 0, lng: 0 },
  priority: 1,
  start: 45 * MS_PER_MINUTE,
  durationMinutes: 16,
  open: null,
  close: null,
  minStayMinutes: null,
  maxStayMinutes: null,
  fixedStart: null,
}

const transport: TransportSlot = {
  start: 15 * MS_PER_MINUTE,
  durationMinutes: 15,
  from: { lat: 0, lng: 0 },
  to: { lat: 0, lng: 0 },
  baseSpeedKmh: null,
}

describe('slot 显示高度', () => {
  it('时长总是向上取整到 15 分钟步数', () => {
    expect(getSlotHeightSteps(1)).toBe(1)
    expect(getSlotHeightSteps(15)).toBe(1)
    expect(getSlotHeightSteps(16)).toBe(2)
    expect(getSlotHeightSteps(45)).toBe(3)
  })

  it('为空白日期生成覆盖整个日窗口的空档行', () => {
    expect(buildDayRows({ legs: [] }, 0, 60 * MS_PER_MINUTE)).toEqual([
      { kind: 'gap', key: 'gap-end', startUtc: 0, endUtc: 60 * MS_PER_MINUTE },
    ])
  })

  it('保留空档、交通和停留行，以便分别按其时长设置显示高度', () => {
    const day: DayPlan = {
      date: '2026-09-04',
      alternatives: [],
      legs: [{ transport, place }],
    }

    expect(buildDayRows(day, 0, 90 * MS_PER_MINUTE)).toEqual([
      { kind: 'gap', key: 'gap-t-0', startUtc: 0, endUtc: 15 * MS_PER_MINUTE },
      { kind: 'transport', key: 'transport-0', legIndex: 0 },
      {
        kind: 'gap',
        key: 'gap-p-0',
        startUtc: 30 * MS_PER_MINUTE,
        endUtc: 45 * MS_PER_MINUTE,
      },
      { kind: 'place', key: 'place-0', legIndex: 0 },
      {
        kind: 'gap',
        key: 'gap-end',
        startUtc: 61 * MS_PER_MINUTE,
        endUtc: 90 * MS_PER_MINUTE,
      },
    ])
  })
})
