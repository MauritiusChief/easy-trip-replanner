import {
  DEFAULT_DAILY_END,
  DEFAULT_DAILY_START,
  MS_PER_MINUTE,
  SCHEMA_VERSION,
} from '../domain/config'
import { haversineKm, impliedSpeedKmh } from '../domain/geo'
import { dayKeyToUtcEpoch } from '../domain/time'
import type {
  DateISO,
  EpochMs,
  GeoPoint,
  Leg,
  MinuteOfDay,
  PlaceSlot,
  TransportSlot,
  Trip,
} from '../domain/types'

/**
 * 手动重排标准行程数据（重构阶段 0 产出）。
 *
 * 最小确定性数据：单日、固定日期 2030-06-01、东京时区（全年 UTC+9，
 * 6 月无夏令时），所有时间落在 5 分钟网格上，可直接断言。
 *
 * 覆盖的关键场景与时间轴（now 预设见 STANDARD_NOW）：
 * - 无锁定前缀：freshMorning（08:00，窗口起点）时前缀为空
 * - 已完成地点：std-done 09:00–10:00
 * - 当前地点：std-current 10:10–11:10（inTransport 时正处交通段，
 *   atCurrentPlace 时正处停留段）
 * - 固定锚点：std-anchor fixedStart 12:00，12:00–13:00
 * - 时间重叠：std-flex-b 的交通 13:45 出发，与 std-flex-a 的停留
 *   （13:30–14:30）蓄意重叠
 * - 开放时间冲突：std-flex-c 15:30 到达，但 17:00 才开门
 * - 异常速度：std-flex-d 前序约 20 公里，交通仅 20 分钟，
 *   基准速度 20 km/h 与隐含速度偏差远超阈值
 * - 中途退出：待选卡槽数 ≥ 2（实际 4 张），保存部分卡片后可退出
 *
 * 除上述蓄意冲突外，基础数据不产生其他警告
 * （固定时间满足、窗口内、无缺失交通、无最短停留）。
 */

export const STANDARD_TIMEZONE = 'Asia/Tokyo'
export const STANDARD_DAY_KEY: DateISO = '2030-06-01'

/** 旅行时区当日分钟 → 该标准日的 UTC 时刻。 */
export function stdEpoch(minuteOfDay: MinuteOfDay): EpochMs {
  return dayKeyToUtcEpoch(STANDARD_DAY_KEY, minuteOfDay, STANDARD_TIMEZONE)
}

/** 场景用的"当前时刻"预设。 */
export const STANDARD_NOW = {
  /** 08:00，窗口起点：当日尚未开始，无锁定前缀。 */
  freshMorning: stdEpoch(8 * 60),
  /** 10:05，正处于前往 std-current 的交通段。 */
  inTransport: stdEpoch(10 * 60 + 5),
  /** 10:30，正处于 std-current 停留段。 */
  atCurrentPlace: stdEpoch(10 * 60 + 30),
  /** 12:30，正处于固定锚点停留段。 */
  atAnchor: stdEpoch(12 * 60 + 30),
  /** 18:00，当天行程已全部结束（仍在窗口内）。 */
  afterAll: stdEpoch(18 * 60),
  /** 22:00，已过当日窗口终点。 */
  afterWindow: stdEpoch(22 * 60),
} as const

const PLACES: Record<string, GeoPoint> = {
  done: { lat: 35.7148, lng: 139.7967 },
  current: { lat: 35.7101, lng: 139.8107 },
  anchor: { lat: 35.6578, lng: 139.701 },
  flexA: { lat: 35.6692, lng: 139.706 },
  flexB: { lat: 35.6717, lng: 139.7639 },
  flexC: { lat: 35.6745, lng: 139.7605 },
  flexD: { lat: 35.5, lng: 139.7 },
}

function place(seed: {
  id: string
  name: string
  location: GeoPoint
  priority: number
  start: EpochMs
  durationMinutes: number
  open?: MinuteOfDay
  fixedStart?: MinuteOfDay
}): PlaceSlot {
  return {
    id: seed.id,
    name: seed.name,
    location: seed.location,
    priority: seed.priority,
    start: seed.start,
    durationMinutes: seed.durationMinutes,
    open: seed.open ?? null,
    close: null,
    minStayMinutes: null,
    maxStayMinutes: null,
    fixedStart: seed.fixedStart ?? null,
  }
}

/** 构造交通 slot；baseSpeedKmh 缺省时按距离反推隐含速度基准。 */
function makeTransport(
  start: EpochMs,
  durationMinutes: number,
  from: GeoPoint,
  to: GeoPoint,
  baseSpeedKmh?: number,
): TransportSlot {
  return {
    start,
    durationMinutes,
    from,
    to,
    baseSpeedKmh:
      baseSpeedKmh ?? impliedSpeedKmh(haversineKm(from, to), durationMinutes),
  }
}

function leg(placeSlot: PlaceSlot, transport: TransportSlot | null): Leg {
  return { transport, place: placeSlot }
}

/** 构建标准单日行程（纯数据，每次调用生成全新对象）。 */
export function buildStandardReorderTrip(): Trip {
  const legs: Leg[] = [
    leg(
      place({
        id: 'std-done',
        name: '清晨景点（已完成）',
        location: PLACES.done,
        priority: 2,
        start: stdEpoch(9 * 60),
        durationMinutes: 60,
      }),
      null,
    ),
    leg(
      place({
        id: 'std-current',
        name: '上午景点（进行中）',
        location: PLACES.current,
        priority: 1,
        start: stdEpoch(10 * 60 + 10),
        durationMinutes: 60,
      }),
      makeTransport(stdEpoch(10 * 60), 10, PLACES.done, PLACES.current),
    ),
    leg(
      place({
        id: 'std-anchor',
        name: '固定预约景点',
        location: PLACES.anchor,
        priority: 1,
        start: stdEpoch(12 * 60),
        durationMinutes: 60,
        fixedStart: 12 * 60,
      }),
      makeTransport(stdEpoch(11 * 60 + 30), 30, PLACES.current, PLACES.anchor),
    ),
    leg(
      place({
        id: 'std-flex-a',
        name: '弹性地点甲',
        location: PLACES.flexA,
        priority: 3,
        start: stdEpoch(13 * 60 + 30),
        durationMinutes: 60,
      }),
      makeTransport(stdEpoch(13 * 60), 30, PLACES.anchor, PLACES.flexA),
    ),
    leg(
      // 时间重叠场景：交通 13:45 出发，与弹性甲的停留（13:30–14:30）重叠
      place({
        id: 'std-flex-b',
        name: '弹性地点乙（时间重叠）',
        location: PLACES.flexB,
        priority: 3,
        start: stdEpoch(14 * 60 + 15),
        durationMinutes: 60,
      }),
      makeTransport(stdEpoch(13 * 60 + 45), 30, PLACES.flexA, PLACES.flexB),
    ),
    leg(
      // 开放时间冲突场景：15:30 到达，但 17:00 才开门
      place({
        id: 'std-flex-c',
        name: '弹性地点丙（开门前到达）',
        location: PLACES.flexC,
        priority: 2,
        start: stdEpoch(15 * 60 + 30),
        durationMinutes: 45,
        open: 17 * 60,
      }),
      makeTransport(stdEpoch(15 * 60 + 15), 15, PLACES.flexB, PLACES.flexC),
    ),
    leg(
      // 异常速度场景：约 20 公里只留 20 分钟，基准 20 km/h 明显偏低
      place({
        id: 'std-flex-d',
        name: '弹性地点丁（速度异常）',
        location: PLACES.flexD,
        priority: 4,
        start: stdEpoch(16 * 60 + 35),
        durationMinutes: 60,
      }),
      makeTransport(stdEpoch(16 * 60 + 15), 20, PLACES.flexC, PLACES.flexD, 20),
    ),
  ]

  return {
    schemaVersion: SCHEMA_VERSION,
    name: '手动重排标准数据',
    timezone: STANDARD_TIMEZONE,
    startDate: STANDARD_DAY_KEY,
    endDate: STANDARD_DAY_KEY,
    dailyStart: DEFAULT_DAILY_START,
    dailyEnd: DEFAULT_DAILY_END,
    dayOverrides: {},
    days: [{ date: STANDARD_DAY_KEY, legs, alternatives: [] }],
  }
}

/** 测试断言用的毫秒换算：标准日内推进若干分钟。 */
export function stdAddMinutes(epochMs: EpochMs, minutes: number): EpochMs {
  return epochMs + minutes * MS_PER_MINUTE
}
