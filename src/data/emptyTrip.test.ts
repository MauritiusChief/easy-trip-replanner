import { describe, expect, it } from 'vitest'
import { createEmptyTrip } from './emptyTrip'
import { validateTrip } from './validate'
import { todayKeyInZone } from '../domain/time'

describe('createEmptyTrip：空行程工厂', () => {
  it('生成可通过数据校验的合法行程', () => {
    const trip = createEmptyTrip()
    expect(validateTrip(trip)).not.toBeNull()
  })

  it('单日空行程：日期为旅行时区"今天"，无行程段与备选', () => {
    const trip = createEmptyTrip()
    expect(trip.days).toHaveLength(1)
    expect(trip.days[0].date).toBe(todayKeyInZone(trip.timezone))
    expect(trip.days[0].legs).toEqual([])
    expect(trip.days[0].alternatives).toEqual([])
    expect(trip.startDate).toBe(trip.endDate)
  })

  it('名称非空、时区为合法 IANA 名称', () => {
    const trip = createEmptyTrip()
    expect(trip.name.length).toBeGreaterThan(0)
    expect(validateTrip({ ...trip, name: '' })).toBeNull()
  })
})
