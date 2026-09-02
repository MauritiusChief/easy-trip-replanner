import {
  DEFAULT_DAILY_END,
  DEFAULT_DAILY_START,
  DEFAULT_SAMPLE_TIMEZONE,
  MS_PER_MINUTE,
  SCHEMA_VERSION,
} from '../domain/config'
import { haversineKm, impliedSpeedKmh } from '../domain/geo'
import { addDaysToDayKey, dayKeyToUtcEpoch, todayKeyInZone } from '../domain/time'
import type {
  AlternativePlace,
  DateISO,
  DayPlan,
  EpochMs,
  GeoPoint,
  Leg,
  MinuteOfDay,
  PlaceId,
  PlaceSlot,
  TransportSlot,
  Trip,
} from '../domain/types'

/**
 * 示例行程（阶段 0 产出）：3 天东京行程，坐标为真实地点的近似值。
 *
 * 刻意覆盖的测试场景（供阶段 2/3 手动验收）：
 * - 固定预约：晴空塔 12:00、涩谷 Sky 14:00、teamLab 14:00
 * - 可取消地点：三顿午餐、竹下通、台场海滨公园（minStay 为空）
 * - 备选地点库：三顿午餐各链接 2 个日级备选，属性完全独立
 *   （各自的开放时间、停留时长/上下限、优先级）
 * - 开放时间边界：银座 09:45 到达但 10:00 才开门（蓄意的冲突案例）
 * - 空档：第 1 天 11:20–11:40 缓冲、第 3 天 13:10–13:30 排队缓冲
 * - 跨日窗口：第 3 天 08:00 开始（早于默认 09:00）
 * - 交通速度谱系：步行 3–6 km/h 到列车 14 km/h
 *
 * 第 1 天日期取"今天"（旅行时区），保证打开应用即可看到当前状态高亮。
 */

interface PlaceSeedBase {
  id: PlaceId
  name: string
  location: GeoPoint
  priority: number
  open?: MinuteOfDay
  close?: MinuteOfDay
  minStay?: MinuteOfDay
  maxStay?: MinuteOfDay
  fixedStart?: MinuteOfDay
}

interface LegSeed {
  place: PlaceSeedBase
  stayMinutes: number
  /** 到达该地点的交通时长；首段行程不填。 */
  transportMinutes?: number
}

/** 日级备选库条目种子：属性独立，linkedTo 指向当日的计划地点 id。 */
interface AlternativeSeed extends PlaceSeedBase {
  stayMinutes: number
  linkedTo: PlaceId
}

/** 备选种子 → 存储结构（缺省约束字段补 null）。 */
function toAlternative(seed: AlternativeSeed): AlternativePlace {
  return {
    id: seed.id,
    name: seed.name,
    location: seed.location,
    priority: seed.priority,
    durationMinutes: seed.stayMinutes,
    open: seed.open ?? null,
    close: seed.close ?? null,
    minStayMinutes: seed.minStay ?? null,
    maxStayMinutes: seed.maxStay ?? null,
    fixedStart: seed.fixedStart ?? null,
    linkedPlaceId: seed.linkedTo,
  }
}

/** 构造交通 slot 并按距离反推隐含速度基准。 */
function makeTransport(
  start: EpochMs,
  durationMinutes: number,
  from: GeoPoint,
  to: GeoPoint,
): TransportSlot {
  const distanceKm = haversineKm(from, to)
  return {
    start,
    durationMinutes,
    from,
    to,
    baseSpeedKmh: impliedSpeedKmh(distanceKm, durationMinutes),
  }
}

/**
 * 按种子顺序生成一天的行程段，时间自动推进：
 * - 普通地点：交通从游标位置出发，停留接在到达之后
 * - 固定锚点：停留固定在 fixedStart，交通倒推为"固定时刻 - 交通时长"，
 *   与前序行程之间自然形成空档（缓冲）
 * 时间全部落在 5 分钟网格上（种子值均为 5 的倍数）。
 */
function buildLegs(
  dayKey: DateISO,
  firstStartMinute: MinuteOfDay,
  seeds: LegSeed[],
  timeZone: string,
): Leg[] {
  const legs: Leg[] = []
  let cursor = dayKeyToUtcEpoch(dayKey, firstStartMinute, timeZone)
  let previousLocation: GeoPoint | null = null
  for (const seed of seeds) {
    const { place, stayMinutes, transportMinutes } = seed
    let transport: TransportSlot | null = null
    let placeStart: EpochMs
    const fixedStartUtc =
      place.fixedStart !== undefined
        ? dayKeyToUtcEpoch(dayKey, place.fixedStart, timeZone)
        : null
    if (fixedStartUtc !== null && transportMinutes && previousLocation) {
      transport = makeTransport(
        fixedStartUtc - transportMinutes * MS_PER_MINUTE,
        transportMinutes,
        previousLocation,
        place.location,
      )
      placeStart = fixedStartUtc
    } else if (transportMinutes && previousLocation) {
      transport = makeTransport(cursor, transportMinutes, previousLocation, place.location)
      placeStart = transport.start + transportMinutes * MS_PER_MINUTE
    } else {
      placeStart = fixedStartUtc ?? cursor
    }
    const slot: PlaceSlot = {
      id: place.id,
      name: place.name,
      location: place.location,
      priority: place.priority,
      start: placeStart,
      durationMinutes: stayMinutes,
      open: place.open ?? null,
      close: place.close ?? null,
      minStayMinutes: place.minStay ?? null,
      maxStayMinutes: place.maxStay ?? null,
      fixedStart: place.fixedStart ?? null,
    }
    legs.push({ transport, place: slot })
    cursor = placeStart + stayMinutes * MS_PER_MINUTE
    previousLocation = place.location
  }
  return legs
}

/** 东京真实地点坐标（近似到街道级），键名仅用于种子数据内部引用。 */
const TOKYO: Record<string, GeoPoint> = {
  sensoji: { lat: 35.7148, lng: 139.7967 },
  skytree: { lat: 35.7101, lng: 139.8107 },
  d1Lunch: { lat: 35.7118, lng: 139.8125 },
  ameyoko: { lat: 35.7133, lng: 139.7771 },
  akihabara: { lat: 35.6989, lng: 139.7731 },
  d1Dinner: { lat: 35.6994, lng: 139.7694 },
  meiji: { lat: 35.6764, lng: 139.6993 },
  takeshita: { lat: 35.6712, lng: 139.7024 },
  d2Lunch: { lat: 35.6692, lng: 139.706 },
  shibuyaCrossing: { lat: 35.6595, lng: 139.7005 },
  shibuyaSky: { lat: 35.6578, lng: 139.701 },
  gyoen: { lat: 35.6852, lng: 139.71 },
  d2Dinner: { lat: 35.6926, lng: 139.7048 },
  tsukiji: { lat: 35.6654, lng: 139.7707 },
  ginza: { lat: 35.6717, lng: 139.7639 },
  d3Lunch: { lat: 35.6745, lng: 139.7605 },
  teamlab: { lat: 35.6488, lng: 139.7902 },
  odaibaBeach: { lat: 35.6297, lng: 139.7756 },
  d3Dinner: { lat: 35.6284, lng: 139.7745 },
  hotel: { lat: 35.7118, lng: 139.795 },
}

/** 第 1 天（浅草→晴空塔→上野/秋叶原），09:00 开始。 */
function day1Seeds(): LegSeed[] {
  return [
    {
      place: {
        id: 'd1-sensoji',
        name: '浅草寺·仲见世通',
        location: TOKYO.sensoji,
        priority: 2,
        open: 6 * 60,
        close: 17 * 60,
        minStay: 60,
        maxStay: 150,
      },
      stayMinutes: 140,
    },
    {
      // 固定预约：停留必须 12:00 开始，交通从 11:40 倒推，前面留 20 分钟缓冲空档
      place: {
        id: 'd1-skytree',
        name: '东京晴空塔',
        location: TOKYO.skytree,
        priority: 1,
        open: 8 * 60,
        close: 22 * 60,
        minStay: 60,
        maxStay: 120,
        fixedStart: 12 * 60,
      },
      stayMinutes: 90,
      transportMinutes: 20,
    },
    {
      // 可取消午餐；它的 2 个备选在 day1Alternatives（日级库）
      place: {
        id: 'd1-lunch',
        name: '晴空塔附近定食屋',
        location: TOKYO.d1Lunch,
        priority: 4,
      },
      stayMinutes: 60,
      transportMinutes: 5,
    },
    {
      place: {
        id: 'd1-ameyoko',
        name: '阿美横町商店街',
        location: TOKYO.ameyoko,
        priority: 3,
        open: 10 * 60,
        close: 20 * 60,
        minStay: 60,
        maxStay: 150,
      },
      stayMinutes: 110,
      transportMinutes: 30,
    },
    {
      place: {
        id: 'd1-akihabara',
        name: '秋叶原电器街',
        location: TOKYO.akihabara,
        priority: 3,
        minStay: 45,
        maxStay: 180,
      },
      stayMinutes: 130,
      transportMinutes: 25,
    },
    {
      place: {
        id: 'd1-dinner',
        name: '秋叶原拉面店',
        location: TOKYO.d1Dinner,
        priority: 4,
        minStay: 30,
        maxStay: 90,
      },
      stayMinutes: 60,
      transportMinutes: 5,
    },
  ]
}

/** 第 2 天（明治神宫→原宿→涩谷→新宿），09:00 开始，含第二个固定预约。 */
function day2Seeds(): LegSeed[] {
  return [
    {
      place: {
        id: 'd2-meiji',
        name: '明治神宫',
        location: TOKYO.meiji,
        priority: 2,
        open: 6 * 60,
        close: 18 * 60,
        minStay: 60,
        maxStay: 120,
      },
      stayMinutes: 90,
    },
    {
      // minStay 缺省 → 可取消地点
      place: {
        id: 'd2-takeshita',
        name: '原宿竹下通',
        location: TOKYO.takeshita,
        priority: 4,
        open: 10 * 60,
        close: 20 * 60,
        maxStay: 90,
      },
      stayMinutes: 60,
      transportMinutes: 10,
    },
    {
      place: {
        id: 'd2-lunch',
        name: '原宿轻食店',
        location: TOKYO.d2Lunch,
        priority: 4,
      },
      stayMinutes: 60,
      transportMinutes: 5,
    },
    {
      place: {
        id: 'd2-crossing',
        name: '涩谷十字路口·忠犬八公像',
        location: TOKYO.shibuyaCrossing,
        priority: 1,
        minStay: 20,
      },
      stayMinutes: 40,
      transportMinutes: 20,
    },
    {
      // 固定预约 14:00；到发间隔只有 5 分钟，前序结束 13:45 后有 10 分钟集合缓冲
      place: {
        id: 'd2-sky',
        name: '涩谷 Sky 观景台',
        location: TOKYO.shibuyaSky,
        priority: 1,
        open: 10 * 60,
        close: 21 * 60 + 30,
        minStay: 45,
        maxStay: 90,
        fixedStart: 14 * 60,
      },
      stayMinutes: 60,
      transportMinutes: 5,
    },
    {
      place: {
        id: 'd2-gyoen',
        name: '新宿御苑',
        location: TOKYO.gyoen,
        priority: 3,
        open: 9 * 60,
        close: 18 * 60,
        minStay: 40,
        maxStay: 120,
      },
      stayMinutes: 120,
      transportMinutes: 25,
    },
    {
      place: {
        id: 'd2-dinner',
        name: '新宿割烹晚餐',
        location: TOKYO.d2Dinner,
        priority: 2,
        minStay: 60,
        maxStay: 120,
      },
      stayMinutes: 100,
      transportMinutes: 10,
    },
  ]
}

/** 第 3 天（筑地→银座→丰洲→台场），08:00 开始（早于默认窗口演示跨日差异）。 */
function day3Seeds(): LegSeed[] {
  return [
    {
      // 早市型开放时间（05:00–14:00），与第 1/2 天的景点时段形成对照
      place: {
        id: 'd3-tsukiji',
        name: '筑地场外市场',
        location: TOKYO.tsukiji,
        priority: 1,
        open: 5 * 60,
        close: 14 * 60,
        minStay: 60,
        maxStay: 120,
      },
      stayMinutes: 90,
    },
    {
      // 蓄意的开放时间冲突案例：09:45 到达，但店铺 10:00 才开门
      place: {
        id: 'd3-ginza',
        name: '银座中央通',
        location: TOKYO.ginza,
        priority: 3,
        open: 10 * 60,
        close: 20 * 60,
        minStay: 60,
        maxStay: 180,
      },
      stayMinutes: 130,
      transportMinutes: 15,
    },
    {
      place: {
        id: 'd3-lunch',
        name: '银座寿司午餐',
        location: TOKYO.d3Lunch,
        priority: 2,
        minStay: 40,
        maxStay: 100,
      },
      stayMinutes: 70,
      transportMinutes: 5,
    },
    {
      // 固定预约 14:00；午餐 13:10 结束后留 20 分钟排队缓冲空档
      place: {
        id: 'd3-teamlab',
        name: 'teamLab Planets',
        location: TOKYO.teamlab,
        priority: 1,
        open: 10 * 60,
        close: 22 * 60,
        minStay: 60,
        maxStay: 120,
        fixedStart: 14 * 60,
      },
      stayMinutes: 90,
      transportMinutes: 30,
    },
    {
      place: {
        id: 'd3-odaiba',
        name: '台场海滨公园',
        location: TOKYO.odaibaBeach,
        priority: 4,
        maxStay: 90,
      },
      stayMinutes: 70,
      transportMinutes: 30,
    },
    {
      place: {
        id: 'd3-dinner',
        name: '台场美食广场晚餐',
        location: TOKYO.d3Dinner,
        priority: 3,
        minStay: 45,
        maxStay: 120,
      },
      stayMinutes: 80,
      transportMinutes: 5,
    },
    {
      place: {
        id: 'd3-hotel',
        name: '返回浅草酒店',
        location: TOKYO.hotel,
        priority: 5,
        minStay: 20,
        maxStay: 60,
      },
      stayMinutes: 40,
      transportMinutes: 40,
    },
  ]
}

/**
 * 第 1 天备选地点库：两个午餐备选，属性刻意各不相同
 * （回转寿司有明确开放时间与停留上下限；便利店无任何约束）。
 */
function day1Alternatives(): AlternativePlace[] {
  const seeds: AlternativeSeed[] = [
    {
      id: 'd1-alt-sushi',
      name: '浅草回转寿司',
      location: TOKYO.sensoji,
      priority: 5,
      stayMinutes: 45,
      open: 11 * 60,
      close: 21 * 60,
      minStay: 30,
      maxStay: 60,
      linkedTo: 'd1-lunch',
    },
    {
      id: 'd1-alt-conbini',
      name: '便利店简餐',
      location: TOKYO.d1Lunch,
      priority: 6,
      stayMinutes: 30,
      linkedTo: 'd1-lunch',
    },
  ]
  return seeds.map(toAlternative)
}

/** 第 2 天备选地点库。 */
function day2Alternatives(): AlternativePlace[] {
  const seeds: AlternativeSeed[] = [
    {
      id: 'd2-alt-crepe',
      name: '竹下通可丽饼',
      location: TOKYO.takeshita,
      priority: 5,
      stayMinutes: 30,
      open: 10 * 60,
      close: 20 * 60,
      maxStay: 45,
      linkedTo: 'd2-lunch',
    },
    {
      id: 'd2-alt-conbini',
      name: '便利店饭团',
      location: TOKYO.d2Lunch,
      priority: 6,
      stayMinutes: 30,
      linkedTo: 'd2-lunch',
    },
  ]
  return seeds.map(toAlternative)
}

/** 第 3 天备选地点库。 */
function day3Alternatives(): AlternativePlace[] {
  const seeds: AlternativeSeed[] = [
    {
      id: 'd3-alt-katsu',
      name: '银座炸猪排',
      location: TOKYO.d3Lunch,
      priority: 3,
      stayMinutes: 50,
      open: 11 * 60,
      close: 21 * 60 + 30,
      minStay: 40,
      maxStay: 80,
      linkedTo: 'd3-lunch',
    },
    {
      id: 'd3-alt-underground',
      name: '银座站地下简餐',
      location: TOKYO.ginza,
      priority: 5,
      stayMinutes: 40,
      open: 8 * 60,
      close: 22 * 60,
      linkedTo: 'd3-lunch',
    },
  ]
  return seeds.map(toAlternative)
}

/**
 * 构建示例行程。
 * 每次调用都会重新计算"今天"作为第 1 天，因此仅在首次初始化/数据重置时调用。
 */
export function createSampleTrip(): Trip {
  const timezone = DEFAULT_SAMPLE_TIMEZONE
  const day1 = todayKeyInZone(timezone)
  const day2 = addDaysToDayKey(day1, 1)
  const day3 = addDaysToDayKey(day1, 2)
  const days: DayPlan[] = [
    {
      date: day1,
      legs: buildLegs(day1, 9 * 60, day1Seeds(), timezone),
      alternatives: day1Alternatives(),
    },
    {
      date: day2,
      legs: buildLegs(day2, 9 * 60, day2Seeds(), timezone),
      alternatives: day2Alternatives(),
    },
    {
      date: day3,
      legs: buildLegs(day3, 8 * 60, day3Seeds(), timezone),
      alternatives: day3Alternatives(),
    },
  ]
  return {
    schemaVersion: SCHEMA_VERSION,
    name: '东京三日示例行程',
    timezone,
    startDate: day1,
    endDate: day3,
    dailyStart: DEFAULT_DAILY_START,
    dailyEnd: DEFAULT_DAILY_END,
    dayOverrides: {},
    days,
  }
}
