import { findLeg } from '../domain/current'
import type { CurrentPosition } from '../domain/current'
import { formatZonedTime } from '../domain/time'
import type { Trip } from '../domain/types'
import './StatusBanner.css'

/**
 * 把当前位置翻译成用户文案（需求 9.1）：
 * - 地点："现在应该在 X，应于 HH:mm 离开"
 * - 交通："现在应该正在前往 Y，应于 HH:mm 到达"
 * 其余分支对应窗口内外、旅行前后的静态提示。
 * 时间一律按旅行时区显示。
 */
function describePosition(trip: Trip, position: CurrentPosition): string {
  switch (position.kind) {
    case 'place': {
      const leg = findLeg(trip, position.dayKey, position.legIndex)
      return `现在应该在 ${leg?.place.name ?? '未知地点'}，应于 ${formatZonedTime(position.leaveUtc, trip.timezone)} 离开`
    }
    case 'transport': {
      const leg = findLeg(trip, position.dayKey, position.legIndex)
      return `现在应该正在前往 ${leg?.place.name ?? '未知地点'}，应于 ${formatZonedTime(position.arriveUtc, trip.timezone)} 到达`
    }
    case 'gap':
      return '现在处于空档时间'
    case 'before-day':
      return `今日行程 ${formatZonedTime(position.startUtc, trip.timezone)} 开始`
    case 'after-day':
      return '今日行程已结束'
    case 'before-trip':
      return '旅行尚未开始'
    case 'after-trip':
      return '旅行已结束'
    case 'no-plan':
      return '当日暂无行程安排'
  }
}

/** 置顶状态横幅：随 useNow 时钟自动更新，aria-live 保证读屏可感知变化。 */
export function StatusBanner({
  trip,
  position,
}: {
  trip: Trip
  position: CurrentPosition
}) {
  return (
    <section className="status-banner" role="status" aria-live="polite">
      {describePosition(trip, position)}
    </section>
  )
}
