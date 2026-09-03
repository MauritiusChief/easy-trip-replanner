import { describe, expect, it } from 'vitest'
import { MS_PER_MINUTE } from './config'
import { haversineKm, impliedSpeedKmh } from './geo'
import {
  remainingPendingIds,
  resolveSessionPredecessor,
  startManualReorderSession,
  withCurrentCard,
  withManualReorderSaved,
  withPlaceProcessed,
} from './manualReorder'
import { collectDayWarnings } from './warnings'
import {
  buildStandardReorderTrip,
  STANDARD_DAY_KEY,
  STANDARD_NOW,
  stdEpoch,
} from '../test/standardReorderTrip'
import type { AlternativePlace, Leg, PlaceSlot } from './types'

const DAY = STANDARD_DAY_KEY
const at = stdEpoch

function legById(legs: Leg[], id: string): Leg {
  const found = legs.find((entry) => entry.place.id === id)
  if (!found) throw new Error(`缺少行程段 ${id}`)
  return found
}

function placeById(trip: ReturnType<typeof buildStandardReorderTrip>, id: string): PlaceSlot {
  return legById(trip.days[0].legs, id).place
}

/** 带备选库条目（链接到弹性甲）的标准数据变体，用于验证备选库关联保留。 */
function tripWithAlternative() {
  const base = buildStandardReorderTrip()
  const alternative: AlternativePlace = {
    id: 'std-alt-x',
    name: '弹性甲备选',
    location: base.days[0].legs[3].place.location,
    priority: 6,
    durationMinutes: 45,
    open: null,
    close: null,
    minStayMinutes: null,
    maxStayMinutes: null,
    fixedStart: null,
    linkedPlaceId: 'std-flex-a',
  }
  return {
    alternative,
    trip: {
      ...base,
      days: [{ ...base.days[0], alternatives: [alternative] }],
    },
  }
}

describe('startManualReorderSession：会话创建（R1）', () => {
  it('有当前地点时：锁定前缀、前缀最后地点快照与待选集合正确', () => {
    const trip = buildStandardReorderTrip()
    const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)
    expect(session).not.toBeNull()
    expect(session!.dayKey).toBe(DAY)
    expect(session!.lockedPrefixCount).toBe(2)
    expect(session!.prefixLast?.id).toBe('std-current')
    expect(session!.pendingPlaceIds).toEqual([
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
    expect(session!.processedPlaceIds).toEqual([])
    expect(session!.currentPlaceId).toBeNull()
  })

  it('无锁定前缀：prefixLast 为 null，待选含全部弹性地点', () => {
    const trip = buildStandardReorderTrip()
    const session = startManualReorderSession(trip, DAY, STANDARD_NOW.freshMorning)
    expect(session!.lockedPrefixCount).toBe(0)
    expect(session!.prefixLast).toBeNull()
    expect(session!.pendingPlaceIds).toHaveLength(6)
  })

  it('当天不存在或没有待选时返回 null', () => {
    const trip = buildStandardReorderTrip()
    expect(startManualReorderSession(trip, '2030-06-02', STANDARD_NOW.atCurrentPlace)).toBeNull()
    expect(startManualReorderSession(trip, DAY, STANDARD_NOW.afterAll)).toBeNull()
  })
})

describe('会话内存操作', () => {
  const trip = buildStandardReorderTrip()
  const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!

  it('打开卡片、关闭卡片', () => {
    const opened = withCurrentCard(session, 'std-flex-b')
    expect(opened.currentPlaceId).toBe('std-flex-b')
    expect(withCurrentCard(opened, null).currentPlaceId).toBeNull()
    expect(session.currentPlaceId).toBeNull()
  })

  it('已处理或不存在于待选的卡片不能成为当前卡片', () => {
    const opened = withCurrentCard(session, 'std-flex-b')
    const processed = withPlaceProcessed(opened, 'std-flex-b')
    expect(withCurrentCard(processed, 'std-flex-b')).toBe(processed)
    expect(withCurrentCard(session, 'std-anchor')).toBe(session)
  })

  it('处理后进入选择顺序，剩余待选保持时间轴顺序', () => {
    const opened = withCurrentCard(session, 'std-flex-b')
    const next = withPlaceProcessed(opened, 'std-flex-b')
    expect(next.processedPlaceIds).toEqual(['std-flex-b'])
    expect(next.currentPlaceId).toBeNull()
    expect(remainingPendingIds(next)).toEqual(['std-flex-a', 'std-flex-c', 'std-flex-d'])
    expect(withPlaceProcessed(session, 'std-anchor')).toBe(session)
  })
})

describe('原子保存：基本路径（有锁定前缀）', () => {
  const trip = buildStandardReorderTrip()
  const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!
  const predecessor = resolveSessionPredecessor(trip, session)
  const result = withManualReorderSaved(
    trip,
    DAY,
    { placeId: 'std-flex-a', start: at(14 * 60), transportDurationMinutes: 20 },
    predecessor,
  )
  const resultLegs = result.days[0].legs

  it('前序推导：无已处理时取锁定前缀最后地点', () => {
    expect(predecessor?.id).toBe('std-current')
  })

  it('被选地点进入正式行程：开始时间更新，其余地点属性保留', () => {
    const leg = legById(resultLegs, 'std-flex-a')
    expect(leg.place.start).toBe(at(14 * 60))
    expect(leg.place).toEqual({ ...placeById(trip, 'std-flex-a'), start: at(14 * 60) })
  })

  it('交通与前序一致：from/to/start/时长/隐含速度基准同步', () => {
    const leg = legById(resultLegs, 'std-flex-a')
    const from = placeById(trip, 'std-current').location
    const to = placeById(trip, 'std-flex-a').location
    expect(leg.transport).toEqual({
      start: at(14 * 60) - 20 * MS_PER_MINUTE,
      durationMinutes: 20,
      from,
      to,
      baseSpeedKmh: impliedSpeedKmh(haversineKm(from, to), 20),
    })
  })

  it('后续交通段出发地快照同步为新前序链', () => {
    expect(legById(resultLegs, 'std-flex-b').transport?.from).toEqual(
      placeById(trip, 'std-flex-a').location,
    )
  })

  it('未选择地点保留原时间和位置；锚点不动', () => {
    expect(legById(resultLegs, 'std-flex-b').place.start).toBe(at(14 * 60 + 15))
    expect(legById(resultLegs, 'std-flex-c').place.start).toBe(at(15 * 60 + 30))
    expect(legById(resultLegs, 'std-flex-d').place.start).toBe(at(16 * 60 + 35))
    const anchor = legById(resultLegs, 'std-anchor')
    expect(anchor.place.start).toBe(at(12 * 60))
    expect(anchor.place.fixedStart).toBe(12 * 60)
  })

  it('单次保存直接输出新 Trip：无任何临时状态产物', () => {
    expect(result).not.toBe(trip)
    expect(result.days[0]).not.toBe(trip.days[0])
    expect(Object.keys(result)).toEqual(Object.keys(trip))
    expect(result.days[0].alternatives).toEqual(trip.days[0].alternatives)
  })

  it('数组顺序保持时间轴一致', () => {
    expect(resultLegs.map((leg) => leg.place.id)).toEqual([
      'std-done',
      'std-current',
      'std-anchor',
      'std-flex-a',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
  })

  it('备选库关联保留', () => {
    const { trip: withAlt, alternative } = tripWithAlternative()
    const saved = withManualReorderSaved(
      withAlt,
      DAY,
      { placeId: 'std-flex-a', start: at(14 * 60), transportDurationMinutes: 20 },
      resolveSessionPredecessor(
        withAlt,
        startManualReorderSession(withAlt, DAY, STANDARD_NOW.atCurrentPlace)!,
      ),
    )
    expect(saved.days[0].alternatives).toEqual([alternative])
    expect(saved.days[0].alternatives[0].linkedPlaceId).toBe('std-flex-a')
  })
})

describe('原子保存：连续选择与退出（R2/R3）', () => {
  const trip = buildStandardReorderTrip()
  const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!

  it('下一张卡的默认前序是最近一次保存的地点（含新时间）', () => {
    const trip1 = withManualReorderSaved(
      trip,
      DAY,
      { placeId: 'std-flex-a', start: at(14 * 60), transportDurationMinutes: 20 },
      resolveSessionPredecessor(trip, session),
    )
    const session1 = withPlaceProcessed(session, 'std-flex-a')
    const predecessor = resolveSessionPredecessor(trip1, session1)
    expect(predecessor?.id).toBe('std-flex-a')
    expect(predecessor?.start).toBe(at(14 * 60))
    const trip2 = withManualReorderSaved(
      trip1,
      DAY,
      { placeId: 'std-flex-b', start: at(15 * 60), transportDurationMinutes: 15 },
      predecessor,
    )
    const legB = legById(trip2.days[0].legs, 'std-flex-b')
    expect(legB.transport?.from).toEqual(placeById(trip, 'std-flex-a').location)
    expect(legB.transport?.start).toBe(at(15 * 60) - 15 * MS_PER_MINUTE)
    // 退出会话（丢弃 session）不影响正式行程：未选地点保留原时间
    expect(legById(trip2.days[0].legs, 'std-flex-c').place.start).toBe(at(15 * 60 + 30))
    expect(legById(trip2.days[0].legs, 'std-flex-d').place.start).toBe(at(16 * 60 + 35))
  })

  it('首卡无锁定前缀且无已处理：不创建交通 slot，冲突由警告表达', () => {
    const freshTrip = buildStandardReorderTrip()
    const freshSession = startManualReorderSession(
      freshTrip,
      DAY,
      STANDARD_NOW.freshMorning,
    )!
    const predecessor = resolveSessionPredecessor(freshTrip, freshSession)
    expect(predecessor).toBeNull()
    const saved = withManualReorderSaved(
      freshTrip,
      DAY,
      { placeId: 'std-flex-c', start: at(9 * 60 + 30), transportDurationMinutes: 20 },
      predecessor,
    )
    const legC = legById(saved.days[0].legs, 'std-flex-c')
    expect(legC.place.start).toBe(at(9 * 60 + 30))
    expect(legC.transport).toBeNull()
    // 保存成功（警告不是前置条件），保存后重算出缺失交通警告
    const warnings = collectDayWarnings(saved, saved.days[0])
    const index = saved.days[0].legs.findIndex((leg) => leg.place.id === 'std-flex-c')
    expect(warnings.some((w) => w.kind === 'missing-transport' && w.legIndex === index)).toBe(
      true,
    )
  })
})

describe('原子保存：稳定排序（R2）', () => {
  const trip = buildStandardReorderTrip()
  const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!
  const predecessor = resolveSessionPredecessor(trip, session)
  const save = (start: number) => ({ placeId: 'std-flex-a', start, transportDurationMinutes: 20 })

  it('开始时间与选择顺序倒置：数组按开始时间排列', () => {
    const saved = withManualReorderSaved(trip, DAY, save(at(9 * 60 + 30)), predecessor)
    expect(saved.days[0].legs.map((leg) => leg.place.id)).toEqual([
      'std-done',
      'std-flex-a',
      'std-current',
      'std-anchor',
      'std-flex-b',
      'std-flex-c',
      'std-flex-d',
    ])
  })

  it('开始时间相同：稳定保留既有数组顺序', () => {
    const saved = withManualReorderSaved(trip, DAY, save(at(12 * 60)), predecessor)
    const ids = saved.days[0].legs.map((leg) => leg.place.id)
    expect(ids.indexOf('std-anchor')).toBeLessThan(ids.indexOf('std-flex-a'))
  })
})

describe('原子保存：锚点保护与防御（R4）', () => {
  const trip = buildStandardReorderTrip()
  const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!
  const predecessor = resolveSessionPredecessor(trip, session)

  it('传入固定锚点 id 时原样返回（锚点不可经手动重排移动）', () => {
    const saved = withManualReorderSaved(
      trip,
      DAY,
      { placeId: 'std-anchor', start: at(16 * 60), transportDurationMinutes: 20 },
      predecessor,
    )
    expect(saved).toBe(trip)
  })

  it('可调整地点保存到与锚点冲突的时刻：锚点不动，冲突只产生警告', () => {
    const saved = withManualReorderSaved(
      trip,
      DAY,
      { placeId: 'std-flex-a', start: at(12 * 60 + 30), transportDurationMinutes: 20 },
      predecessor,
    )
    const anchor = legById(saved.days[0].legs, 'std-anchor')
    expect(anchor.place.start).toBe(at(12 * 60))
    const warnings = collectDayWarnings(saved, saved.days[0])
    const index = saved.days[0].legs.findIndex((leg) => leg.place.id === 'std-flex-a')
    expect(warnings.some((w) => w.kind === 'overlap' && w.legIndex === index)).toBe(true)
  })

  it('地点 id 不存在时原样返回', () => {
    const saved = withManualReorderSaved(
      trip,
      DAY,
      { placeId: 'no-such-place', start: at(14 * 60), transportDurationMinutes: 20 },
      predecessor,
    )
    expect(saved).toBe(trip)
  })

  it('其余日期保持引用不变', () => {
    const base = buildStandardReorderTrip()
    const otherDay = { date: '2030-06-02', legs: [], alternatives: [] }
    const multiDay = { ...base, days: [...base.days, otherDay] }
    const saved = withManualReorderSaved(
      multiDay,
      DAY,
      { placeId: 'std-flex-a', start: at(14 * 60), transportDurationMinutes: 20 },
      predecessor,
    )
    expect(saved.days[1]).toBe(otherDay)
  })
})

describe('原子保存：5 分钟粒度兜底', () => {
  it('开始时间与时长取整到 5 分钟网格', () => {
    const trip = buildStandardReorderTrip()
    const session = startManualReorderSession(trip, DAY, STANDARD_NOW.atCurrentPlace)!
    const saved = withManualReorderSaved(
      trip,
      DAY,
      { placeId: 'std-flex-a', start: at(14 * 60 + 3), transportDurationMinutes: 17 },
      resolveSessionPredecessor(trip, session),
    )
    const leg = legById(saved.days[0].legs, 'std-flex-a')
    expect(leg.place.start).toBe(at(14 * 60 + 5))
    expect(leg.transport?.durationMinutes).toBe(15)
    expect(leg.transport?.start).toBe(at(14 * 60 + 5) - 15 * MS_PER_MINUTE)
  })
})
