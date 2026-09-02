import { dayKeyToLabel, dayKeyToWeekdayLabel, formatMinuteOfDay } from '../domain/time'
import type { Trip } from '../domain/types'

/** 行程头部：名称、起止日期（含星期）、统一每日窗口与旅行时区。 */
export function TripHeader({ trip }: { trip: Trip }) {
  return (
    <header className="trip-header">
      <h1>{trip.name}</h1>
      <p className="trip-meta">
        {dayKeyToLabel(trip.startDate)}（{dayKeyToWeekdayLabel(trip.startDate)}）
        {' – '}
        {dayKeyToLabel(trip.endDate)}（{dayKeyToWeekdayLabel(trip.endDate)}）
        {' · '}
        {formatMinuteOfDay(trip.dailyStart)}–{formatMinuteOfDay(trip.dailyEnd)}
        {' · '}
        {trip.timezone}
      </p>
    </header>
  )
}
