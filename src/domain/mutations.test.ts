import { describe, expect, it } from 'vitest'
import { MS_PER_MINUTE } from './config'
import { haversineKm, impliedSpeedKmh } from './geo'
import {
  withPlaceSaved,
  withTransportDeleted,
  withTransportDuration,
  withTransportInserted,
  withTripSettingsSaved,
} from './mutations'
import { buildStandardReorderTrip, STANDARD_DAY_KEY } from '../test/standardReorderTrip'

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

describe('地点与交通编辑', () => {
  it('修改地点开始时间时，到达交通结束时刻贴紧新开始时间', () => {
    const trip = buildStandardReorderTrip()
    const original = trip.days[0].legs[3]
    const nextStart = original.place.start + 35 * MS_PER_MINUTE
    const place = { ...original.place, start: nextStart }

    const saved = withPlaceSaved(trip, STANDARD_DAY_KEY, 3, place)
    const transport = saved.days[0].legs[3].transport

    expect(transport).not.toBeNull()
    expect(transport?.start).toBe(nextStart - original.transport!.durationMinutes * MS_PER_MINUTE)
    expect(transport?.durationMinutes).toBe(original.transport!.durationMinutes)
    expect(transport?.to).toEqual(place.location)
    expect(saved.days[0].legs[4].transport?.from).toEqual(place.location)
  })

  it('可为非首段缺失交通的地点补建默认 30 分钟交通', () => {
    const source = buildStandardReorderTrip()
    const legs = source.days[0].legs.map((leg, index) =>
      index === 3 ? { ...leg, transport: null } : leg,
    )
    const trip = { ...source, days: [{ ...source.days[0], legs }] }

    const saved = withTransportInserted(trip, STANDARD_DAY_KEY, 3)
    const target = saved.days[0].legs[3]

    expect(target.transport).toMatchObject({
      start: target.place.start - 30 * MS_PER_MINUTE,
      durationMinutes: 30,
      from: saved.days[0].legs[2].place.location,
      to: target.place.location,
    })
  })

  it('修改交通时长时，交通结束时刻仍贴紧地点开始时间', () => {
    const trip = buildStandardReorderTrip()
    const target = trip.days[0].legs[3]
    const durationMinutes = 45

    const saved = withTransportDuration(trip, STANDARD_DAY_KEY, 3, durationMinutes)
    const transport = saved.days[0].legs[3].transport

    expect(transport).not.toBeNull()
    expect(transport?.durationMinutes).toBe(durationMinutes)
    expect(transport?.start).toBe(target.place.start - durationMinutes * MS_PER_MINUTE)
    expect(transport?.baseSpeedKmh).toBe(
      impliedSpeedKmh(haversineKm(target.transport!.from, target.place.location), durationMinutes),
    )
  })

  it('不为首段或已有交通的地点重复创建交通', () => {
    const trip = buildStandardReorderTrip()
    const first = withTransportInserted(trip, STANDARD_DAY_KEY, 0)
    const existing = withTransportInserted(trip, STANDARD_DAY_KEY, 3)

    expect(first.days[0].legs[0].transport).toBeNull()
    expect(existing.days[0].legs[3].transport).toBe(trip.days[0].legs[3].transport)
  })

  it('删除交通只移除目标地点的到达交通', () => {
    const trip = buildStandardReorderTrip()
    const previousTransport = trip.days[0].legs[2].transport
    const followingTransport = trip.days[0].legs[4].transport

    const saved = withTransportDeleted(trip, STANDARD_DAY_KEY, 3)

    expect(saved.days[0].legs[3].transport).toBeNull()
    expect(saved.days[0].legs[2].transport).toBe(previousTransport)
    expect(saved.days[0].legs[4].transport).toBe(followingTransport)
  })
})
