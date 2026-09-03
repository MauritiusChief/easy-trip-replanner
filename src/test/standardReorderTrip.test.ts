import { describe, expect, it } from 'vitest'
import { getCurrentPosition } from '../domain/current'
import { classifyReorderScope } from '../domain/reorderRules'
import { collectDayWarnings } from '../domain/warnings'
import {
  buildStandardReorderTrip,
  STANDARD_NOW,
  stdEpoch,
} from './standardReorderTrip'

describe('标准数据结构', () => {
  it('单日行程，地点与场景一一对应', () => {
    const trip = buildStandardReorderTrip()
    expect(trip.days).toHaveLength(1)
    expect(trip.days[0].date).toBe('2030-06-01')
    expect(trip.days[0].legs.map((entry) => entry.place.id)).toEqual([
      'std-done',
      'std-current',
      'std-anchor',
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
  })

  it('多次构建结果完全一致（确定性数据）', () => {
    expect(buildStandardReorderTrip()).toEqual(buildStandardReorderTrip())
  })
})

describe('标准数据复现关键警告场景', () => {
  const trip = buildStandardReorderTrip()
  const warnings = collectDayWarnings(trip, trip.days[0])

  it('时间重叠：弹性乙的交通与弹性甲的停留重叠（legIndex 4）', () => {
    expect(
      warnings.some((warning) => warning.kind === 'overlap' && warning.legIndex === 4),
    ).toBe(true)
  })

  it('开放时间冲突：弹性丙开门前到达（legIndex 5）', () => {
    expect(
      warnings.some((warning) => warning.kind === 'open-hours' && warning.legIndex === 5),
    ).toBe(true)
  })

  it('异常速度：弹性丁的交通隐含速度偏离基准（legIndex 6）', () => {
    expect(
      warnings.some(
        (warning) => warning.kind === 'speed-anomaly' && warning.legIndex === 6,
      ),
    ).toBe(true)
  })

  it('除三个蓄意场景警告外，基础数据不产生其他警告', () => {
    expect(warnings.map((warning) => [warning.kind, warning.legIndex])).toEqual([
      ['overlap', 4],
      ['open-hours', 5],
      ['speed-anomaly', 6],
    ])
    const kinds = new Set(warnings.map((warning) => warning.kind))
    expect(kinds).not.toContain('fixed-conflict')
    expect(kinds).not.toContain('missing-transport')
    expect(kinds).not.toContain('min-stay')
    expect(kinds).not.toContain('out-of-window')
  })

  it('R4：可调整地点保存到与锚点冲突的时刻，锚点不动、冲突仅以警告表达', () => {
    const day = trip.days[0]
    day.legs[3].place.start = stdEpoch(12 * 60 + 30)
    const moved = collectDayWarnings(trip, day)
    expect(
      moved.some((warning) => warning.kind === 'overlap' && warning.legIndex === 3),
    ).toBe(true)
    expect(moved.some((warning) => warning.legIndex === 2)).toBe(false)
    expect(day.legs[2].place.start).toBe(stdEpoch(12 * 60))
    expect(day.legs[2].place.fixedStart).toBe(12 * 60)
  })
})

describe('标准数据复现当前位置场景', () => {
  const trip = buildStandardReorderTrip()

  it('交通进行中', () => {
    const position = getCurrentPosition(trip, STANDARD_NOW.inTransport)
    expect(position).toMatchObject({
      kind: 'transport',
      legIndex: 1,
      destinationId: 'std-current',
    })
  })

  it('停留进行中（存在当前地点）', () => {
    const position = getCurrentPosition(trip, STANDARD_NOW.atCurrentPlace)
    expect(position).toMatchObject({ kind: 'place', legIndex: 1, placeId: 'std-current' })
  })

  it('当日已开始但处于空档（无锁定前缀场景的 now）', () => {
    expect(getCurrentPosition(trip, STANDARD_NOW.freshMorning)).toMatchObject({
      kind: 'gap',
    })
  })

  it('已过当日窗口终点', () => {
    expect(getCurrentPosition(trip, STANDARD_NOW.afterWindow)).toMatchObject({
      kind: 'after-day',
    })
  })
})

describe('标准数据支撑手动重排关键场景', () => {
  const trip = buildStandardReorderTrip()
  const legs = trip.days[0].legs

  it('中途退出场景：待选卡槽数量 ≥ 2', () => {
    const scope = classifyReorderScope(trip.days[0], STANDARD_NOW.atCurrentPlace)
    expect(scope.pending.length).toBeGreaterThanOrEqual(2)
  })

  it('首张待选卡在无锁定前缀时无可确定前序（不创建交通 slot，R3）', () => {
    const scope = classifyReorderScope(trip.days[0], STANDARD_NOW.freshMorning)
    expect(scope.pending.length).toBeGreaterThan(0)
    expect(scope.prefixLastLocation).toBeNull()
  })

  it('有锁定前缀时首张待选卡的前序来自前缀最后地点', () => {
    const scope = classifyReorderScope(trip.days[0], STANDARD_NOW.atCurrentPlace)
    expect(scope.prefixLastLocation).toEqual(legs[1].place.location)
  })
})
