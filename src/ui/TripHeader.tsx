import { dayKeyToLabel, dayKeyToWeekdayLabel, formatMinuteOfDay } from '../domain/time'
import type { Trip } from '../domain/types'
import { useTripStore } from '../state/tripStore'
import './TripHeader.css'

/** 行程头部：名称、起止日期（含星期）、统一每日窗口与旅行时区，以及"行程设置"入口。 */
export function TripHeader({ trip }: { trip: Trip }) {
  const openEditor = useTripStore((state) => state.openEditor)
  return (
    <header className="trip-header">
      <div className="trip-head-row">
        <h1>{trip.name}</h1>
        <button
          type="button"
          className="btn"
          onClick={() => openEditor({ type: 'trip' })}
        >
          行程设置
        </button>
      </div>
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
