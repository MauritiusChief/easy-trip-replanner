import { describe, expect, it } from 'vitest'
import { withTripSettingsSaved } from './mutations'
import { buildStandardReorderTrip } from '../test/standardReorderTrip'

describe('withTripSettingsSaved：行程级设置', () => {
  it('覆盖名称、时区与每日窗口，范围外的天数不受影响', () => {
    const trip = buildStandardReorderTrip()
    const saved = withTripSettingsSaved(trip, {
      name: '关西之行',
      timezone: 'Asia/Tokyo',
      startDate: '2030-06-01',
      endDate: '2030-06-01',
      dailyStart: 7 * 60,
      dailyEnd: 21 * 60,
    })
    expect(saved.name).toBe('关西之行')
    expect(saved.dailyStart).toBe(7 * 60)
    expect(saved.dailyEnd).toBe(21 * 60)
    expect(saved.days).toHaveLength(1)
    // 原有整天对象原样保留（内容零改动）
    expect(saved.days[0]).toBe(trip.days[0])
  })

  it('扩大日期范围：范围内缺失的日期补空日，已有整天保留', () => {
    const trip = buildStandardReorderTrip()
    const saved = withTripSettingsSaved(trip, {
      name: trip.name,
      timezone: trip.timezone,
      startDate: '2030-05-31',
      endDate: '2030-06-02',
      dailyStart: trip.dailyStart,
      dailyEnd: trip.dailyEnd,
    })
    expect(saved.days.map((day) => day.date)).toEqual([
      '2030-05-31',
      '2030-06-01',
      '2030-06-02',
    ])
    expect(saved.days[1]).toBe(trip.days[0])
    expect(saved.days[0]).toEqual({ date: '2030-05-31', legs: [], alternatives: [] })
    expect(saved.days[2]).toEqual({ date: '2030-06-02', legs: [], alternatives: [] })
  })

  it('缩小日期范围：删除范围外整天及其 dayOverrides', () => {
    const trip = buildStandardReorderTrip()
    trip.dayOverrides = {
      '2030-06-01': { start: 7 * 60 },
      '2030-05-31': { end: 20 * 60 },
    }
    const saved = withTripSettingsSaved(trip, {
      name: trip.name,
      timezone: trip.timezone,
      startDate: '2030-06-01',
      endDate: '2030-06-01',
      dailyStart: trip.dailyStart,
      dailyEnd: trip.dailyEnd,
    })
    expect(saved.days.map((day) => day.date)).toEqual(['2030-06-01'])
    expect(saved.dayOverrides).toEqual({ '2030-06-01': { start: 7 * 60 } })
  })
})
