import { describe, expect, it } from 'vitest'
import {
  classifyLeg,
  classifyReorderScope,
  orderByStartTime,
  resolveNextPredecessor,
} from './reorderRules'
import { buildStandardReorderTrip, STANDARD_NOW } from '../test/standardReorderTrip'
import type { GeoPoint, Leg, PlaceSlot } from './types'

/** 按地点 id 取标准数据中的行程段，缺失即抛错（避免测试内的非空断言）。 */
function legById(legs: Leg[], id: string): Leg {
  const found = legs.find((entry) => entry.place.id === id)
  if (!found) throw new Error(`标准数据缺少行程段 ${id}`)
  return found
}

describe('R1 classifyLeg：单段范围判定', () => {
  const legs = buildStandardReorderTrip().days[0].legs

  it('已结束地点是锁定', () => {
    expect(classifyLeg(legById(legs, 'std-done'), STANDARD_NOW.atCurrentPlace)).toBe(
      'locked',
    )
  })

  it('停留进行中的地点是锁定', () => {
    expect(classifyLeg(legById(legs, 'std-current'), STANDARD_NOW.atCurrentPlace)).toBe(
      'locked',
    )
  })

  it('前往地点的交通进行中，目的地也算锁定', () => {
    expect(classifyLeg(legById(legs, 'std-current'), STANDARD_NOW.inTransport)).toBe(
      'locked',
    )
  })

  it('未来时间且无固定时刻的地点是待选', () => {
    expect(classifyLeg(legById(legs, 'std-flex-a'), STANDARD_NOW.atCurrentPlace)).toBe(
      'pending',
    )
  })

  it('未开始的固定时刻地点是锚点，不进入待选', () => {
    expect(classifyLeg(legById(legs, 'std-anchor'), STANDARD_NOW.atCurrentPlace)).toBe(
      'anchored',
    )
  })

  it('锚点一旦进行中即升级为锁定', () => {
    expect(classifyLeg(legById(legs, 'std-anchor'), STANDARD_NOW.atAnchor)).toBe('locked')
  })

  it('当天尚未开始时未来地点是待选', () => {
    expect(classifyLeg(legById(legs, 'std-done'), STANDARD_NOW.freshMorning)).toBe(
      'pending',
    )
  })
})

describe('R1 classifyReorderScope：整日范围判定', () => {
  const legs = buildStandardReorderTrip().days[0].legs
  const ids = (list: Leg[]) => list.map((entry) => entry.place.id)

  it('无锁定前缀：窗口起点时全部剩余，锚点与待选分开', () => {
    const scope = classifyReorderScope({ legs }, STANDARD_NOW.freshMorning)
    expect(ids(scope.lockedPrefix)).toEqual([])
    expect(scope.prefixLastLocation).toBeNull()
    expect(ids(scope.anchors)).toEqual(['std-anchor'])
    expect(ids(scope.pending)).toEqual([
      'std-done',
      'std-current',
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
  })

  it('存在当前地点：已完成与进行中构成前缀，提供前序坐标', () => {
    const scope = classifyReorderScope({ legs }, STANDARD_NOW.atCurrentPlace)
    expect(ids(scope.lockedPrefix)).toEqual(['std-done', 'std-current'])
    expect(ids(scope.anchors)).toEqual(['std-anchor'])
    expect(ids(scope.pending)).toEqual([
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
    expect(scope.prefixLastLocation).toEqual(legById(legs, 'std-current').place.location)
  })

  it('锚点进行中时归入锁定前缀，锚点区清空', () => {
    const scope = classifyReorderScope({ legs }, STANDARD_NOW.atAnchor)
    expect(ids(scope.lockedPrefix)).toEqual(['std-done', 'std-current', 'std-anchor'])
    expect(ids(scope.anchors)).toEqual([])
    expect(scope.pending).toHaveLength(4)
  })

  it('全天结束后无可选卡槽', () => {
    const scope = classifyReorderScope({ legs }, STANDARD_NOW.afterAll)
    expect(ids(scope.lockedPrefix)).toEqual([
      'std-done',
      'std-current',
      'std-anchor',
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
    expect(scope.anchors).toEqual([])
    expect(scope.pending).toEqual([])
  })
})

describe('R2 orderByStartTime：正式时间轴顺序', () => {
  const getStart = (item: { start: number; tag: string }) => item.start
  const tags = (list: { tag: string }[]) => list.map((item) => item.tag)

  it('按开始时间升序排列', () => {
    const input = [
      { start: 300, tag: 'c' },
      { start: 100, tag: 'a' },
      { start: 200, tag: 'b' },
    ]
    expect(tags(orderByStartTime(input, getStart))).toEqual(['a', 'b', 'c'])
  })

  it('开始时间相同：稳定保留输入（用户选择）顺序', () => {
    const input = [
      { start: 100, tag: '先选' },
      { start: 100, tag: '后选' },
    ]
    expect(tags(orderByStartTime(input, getStart))).toEqual(['先选', '后选'])
  })

  it('开始时间与选择顺序倒置：以开始时间为准，不强行调整', () => {
    const input = [
      { start: 200, tag: '先选' },
      { start: 100, tag: '后选' },
    ]
    expect(tags(orderByStartTime(input, getStart))).toEqual(['后选', '先选'])
  })
})

describe('R3 resolveNextPredecessor：交通前序规则', () => {
  const loc = (lat: number, lng: number): GeoPoint => ({ lat, lng })
  const slot = (id: string, start: number): PlaceSlot => ({
    id,
    name: id,
    location: loc(0, 0),
    priority: 1,
    start,
    durationMinutes: 60,
    open: null,
    close: null,
    minStayMinutes: null,
    maxStayMinutes: null,
    fixedStart: null,
  })

  it('无锁定前缀且无已保存地点：无可确定前序，不创建交通 slot', () => {
    expect(resolveNextPredecessor([], null)).toBeNull()
  })

  it('有锁定前缀：以锁定前缀最后地点为前序', () => {
    const prefixLast = slot('prefix-last', 100)
    expect(resolveNextPredecessor([], prefixLast)).toBe(prefixLast)
  })

  it('已有保存地点：以最近一次保存（选择顺序末位）为前序', () => {
    const prefixLast = slot('prefix-last', 100)
    const first = slot('first', 200)
    const second = slot('second', 300)
    expect(resolveNextPredecessor([first], prefixLast)).toBe(first)
    expect(resolveNextPredecessor([first, second], prefixLast)).toBe(second)
  })
})
