/**
 * 本地数据格式版本，结构变更时递增。
 * v2：备选地点从 Leg 内嵌移至日级备选地点库，属性独立并携带链接字段。
 * 版本不符的存档直接重置为示例行程（见 storage.loadTrip）。
 */
export const SCHEMA_VERSION = 2

/** localStorage 键名。整个应用只使用这一个键。 */
export const STORAGE_KEY = 'easy-trip-replanner:trip'

/** 时间编辑与存储粒度：所有时刻和时长都取整到 5 分钟（需求 2.1）。 */
export const TIME_STEP_MINUTES = 5

/** 一分钟的毫秒数，用于 epoch 毫秒与分钟之间的换算。 */
export const MS_PER_MINUTE = 60_000

/** haversine 公式使用的地球平均半径（公里）。 */
export const EARTH_RADIUS_KM = 6371

/**
 * 绕路判定阈值（需求 6.1，阶段 3 使用）：
 * 经过中间点后的总距离超过"直接前往后续地点"距离的 (1 + 0.5) 倍，
 * 且多出的绝对距离不少于 1 公里，才认为构成明显绕路。
 * 两个条件同时满足，避免短距离内的比例噪声。
 */
export const DETOUR_EXTRA_RATIO = 0.5
export const DETOUR_EXTRA_KM = 1

/**
 * 速度异常阈值（需求 4.4，阶段 3 使用）：
 * 重排改变前序地点后，交通时长保持用户设定不变，
 * 系统按新距离重算隐含速度，与基准速度偏差超过 ±40% 时向用户警告。
 * 首版保守值，待实践中调整（阶段 5 调参）。
 */
export const SPEED_ANOMALY_RATIO = 0.4

/**
 * 路线优化搜索上限（阶段 3 使用）：
 * 可调整区间内地点数不超过此值时尝试精确排列搜索，
 * 超过则退化为贪心近邻策略，控制计算量。
 */
export const ROUTE_EXACT_MAX_PLACES = 8

/** 示例行程使用的时区（东京），便于演示真实坐标与固定预约场景。 */
export const DEFAULT_SAMPLE_TIMEZONE = 'Asia/Tokyo'

/** 默认每日窗口 08:00–22:00（旅行时区当日分钟）。 */
export const DEFAULT_DAILY_START = 8 * 60
export const DEFAULT_DAILY_END = 22 * 60

/** 首页"当前状态"时钟的刷新间隔（毫秒）。 */
export const NOW_TICK_MS = 30_000
