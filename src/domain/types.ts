/**
 * 全局时间表示：UTC 纪元毫秒。
 * 所有 slot 的起止时间都用它存储，时区换算只发生在展示与输入层。
 */
export type EpochMs = number

/**
 * 当日分钟数（0–1439），表示"旅行时区"下的时刻，如 480 = 08:00。
 * 用于开放时间、固定开始时间、每日窗口等"只含时刻、不含日期"的字段。
 */
export type MinuteOfDay = number

/** 日历日，格式 'YYYY-MM-DD'，始终指旅行时区下的日期。 */
export type DateISO = string

/**
 * 地点唯一标识。
 * 同一现实地点在不同日历日视为不同计划数据点（需求 3.3），因此 id 按日命名（如 d1-skytree）。
 */
export type PlaceId = string

/** 经纬度坐标（十进制度），用于直线距离与隐含速度计算。 */
export interface GeoPoint {
  lat: number
  lng: number
}

/**
 * 地点 slot：时间轴上的一段停留，同时携带该数据点的全部规划属性。
 *
 * 约束语义（需求 3.1–3.3）：
 * - minStayMinutes 为 null：该地点允许被整体取消
 * - maxStayMinutes 为 null：停留时长没有上限
 * - fixedStart 为 null：不是固定锚点；非 null 时停留必须在该本地时刻开始，
 *   且地点顺序与开始时间都不可移动（硬约束，重排时最先满足）
 */
export interface PlaceSlot {
  id: PlaceId
  name: string
  location: GeoPoint
  /** 每日优先级，数字越小优先级越高（1 = 最高），仅在同一日历日内比较（需求 3.4）。 */
  priority: number
  /** 停留开始时刻（UTC 毫秒）。 */
  start: EpochMs
  /** 计划停留时长（分钟），5 分钟粒度。 */
  durationMinutes: number
  /** 开放开始时刻（旅行时区当日分钟），null 表示不约束或未知。 */
  open: MinuteOfDay | null
  /** 开放结束时刻（旅行时区当日分钟），null 表示不约束或未知。 */
  close: MinuteOfDay | null
  minStayMinutes: number | null
  maxStayMinutes: number | null
  fixedStart: MinuteOfDay | null
}

/**
 * 备选地点（需求 7）：日级"备选地点库"的条目，属性完全独立。
 *
 * 与 PlaceSlot 的区别：
 * - 没有 start（不排入时间轴，平时不参与计划）
 * - durationMinutes 是备选自己的"计划停留时长"，换入计划时直接沿用
 * - 交通时长不在此设置，换入时由引擎使用默认值（需求 4.4：时长由用户事后调整）
 *
 * linkedPlaceId 指向同日计划中的某个地点，表达"为它准备的替代"；
 * 该地点被删除/取消后条目保留，linkedPlaceId 置 null（"未连接"），
 * 可在编辑器重新绑定；未连接条目不参与重排替换。
 */
export interface AlternativePlace {
  id: PlaceId
  name: string
  location: GeoPoint
  /** 每日优先级，数字越小优先级越高（1 = 最高）。 */
  priority: number
  /** 计划停留时长（分钟），5 分钟粒度；换入计划时作为初始停留。 */
  durationMinutes: number
  /** 开放开始时刻（旅行时区当日分钟），null 表示不约束或未知。 */
  open: MinuteOfDay | null
  /** 开放结束时刻（旅行时区当日分钟），null 表示不约束或未知。 */
  close: MinuteOfDay | null
  /** 最短停留：null 表示可取消（需求 3.1）。 */
  minStayMinutes: number | null
  /** 最长停留：null 表示无上限。 */
  maxStayMinutes: number | null
  fixedStart: MinuteOfDay | null
  /** 链接的计划地点 id；null 表示未连接。 */
  linkedPlaceId: PlaceId | null
}

/**
 * 交通 slot（需求 4）：依附于目的地的一段移动。
 * baseSpeedKmh 是用户建立交通时长时按两点距离反推的"隐含速度"基准。
 * 路线变化（前序地点改变）时交通时长保持不变，系统按新距离重算隐含速度
 * 并与该基准比较，偏差过大则警告（需求 4.4）；距离过近无法推断时为 null。
 * 基准不随重排自动改写，仅当用户手动修改时长时才按新时长重算。
 */
export interface TransportSlot {
  start: EpochMs
  durationMinutes: number
  /** 出发地坐标（生成时的前序地点，重排后可能过时）。 */
  from: GeoPoint
  /** 目的地坐标。 */
  to: GeoPoint
  baseSpeedKmh: number | null
}

/**
 * 时间轴最小单元：一段"到达交通 + 地点停留"。
 * 交通依附目的地（需求 4.2），因此与 place 成对出现；
 * 当天第一段行程没有前序地点，transport 为 null。
 * 备选地点不在 Leg 上：它们存放在日级备选地点库（DayPlan.alternatives）。
 */
export interface Leg {
  transport: TransportSlot | null
  place: PlaceSlot
}

/** 单个日历日的计划。不同日期之间不做联合优化（需求 2.2）。 */
export interface DayPlan {
  date: DateISO
  /** 按时间顺序排列的行程段。 */
  legs: Leg[]
  /** 日级备选地点库（需求 7）：平时不排入时间轴，重排时按链接参与替换。 */
  alternatives: AlternativePlace[]
}

/** 单日窗口覆盖项：不设置的字段回落到旅行级的 dailyStart/dailyEnd。 */
export interface DayWindowOverride {
  start?: MinuteOfDay
  end?: MinuteOfDay
}

/**
 * 行程计划 = 一条多日连续时间轴（需求 2）。
 * 这是应用的唯一主要状态，不维护任何现实执行状态（需求 9.3）。
 */
export interface Trip {
  schemaVersion: 2
  name: string
  /** IANA 时区名（如 Asia/Tokyo），旅行开始前设定，内部时间均按它换算。 */
  timezone: string
  startDate: DateISO
  endDate: DateISO
  /** 每日可规划窗口开始（旅行时区当日分钟），全行程统一（阶段 0 决策）。 */
  dailyStart: MinuteOfDay
  /** 每日可规划窗口结束，结构上预留按日覆盖字段。 */
  dailyEnd: MinuteOfDay
  dayOverrides: Record<DateISO, DayWindowOverride>
  days: DayPlan[]
}

/**
 * 规划警告类别：
 * - detour：绕路提示（阶段 6.2，只提示不自动修改）
 * - speed-anomaly：重算交通后隐含速度与基准偏差过大
 * - open-hours：到访时间超出开放区间
 * - overlap：slot 时间重叠
 * - missing-transport：地点缺少到达交通
 * - out-of-window：超出每日可规划窗口
 * - fixed-conflict：违反固定开始时间锚点
 * - min-stay：停留低于最短时长（含重排压缩提示）
 * - storage-invalid：本地存储数据无效
 * - replan-note：重排引擎的说明性提示（取消/替换等）
 */
export type WarningKind =
  | 'detour'
  | 'speed-anomaly'
  | 'open-hours'
  | 'overlap'
  | 'missing-transport'
  | 'out-of-window'
  | 'fixed-conflict'
  | 'min-stay'
  | 'storage-invalid'
  | 'replan-note'

/** 一条面向用户的规划警告，可关联到某天某段行程。 */
export interface PlanWarning {
  kind: WarningKind
  day: DateISO
  legIndex?: number
  /** 关联的地点 id（重排引擎的取消/压缩/替换提示使用），供草案对比按条目归属。 */
  placeId?: PlaceId
  message: string
}

/**
 * 重排草案（阶段 3 产物）：只替换目标日期 fromLegIndex 之后的行程，
 * 并同步该日备选库（换入条目移除、悬空链接置空），
 * 在用户确认前绝不写入正式计划（需求 1.2）。
 */
export interface ReplanDraft {
  day: DateISO
  fromLegIndex: number
  /** 草案行程段（含取消项的最终排程结果）。 */
  legs: Leg[]
  /** 本次重排中被取消的地点 id。 */
  cancelledPlaceIds: PlaceId[]
  warnings: PlanWarning[]
  /** 无法满足硬约束时的原因说明。 */
  infeasibleReasons: string[]
  createdAt: EpochMs
  /** 生成草案时的"纳入备选地点"开关；逐项采纳后重建草案需要沿用同一参数。 */
  includeAlternatives: boolean
}
