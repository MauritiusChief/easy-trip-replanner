import { useMemo, useState } from 'react'
import { loadTrip, saveTrip } from './data/storage'
import { getCurrentPosition } from './domain/current'
import { getZonedDayKey } from './domain/time'
import { useKeySequence } from './state/useKeySequence'
import { useNow } from './state/useNow'
import { DebugTimePanel } from './ui/DebugTimePanel'
import { DayView } from './ui/DayView'
import { StatusBanner } from './ui/StatusBanner'
import { TripHeader } from './ui/TripHeader'

/**
 * 应用壳（阶段 1 只读版）：
 * 1. 加载行程：localStorage 优先，失败回退示例行程（loadTrip 内部处理并给出提示）
 * 2. 种子持久化：首次打开时把加载结果写回 localStorage（幂等，重复写同值无害）
 * 3. 时钟：useNow 每 30 秒刷新，可被调试面板的时间偏移虚构
 * 4. 位置推导：getCurrentPosition(trip, now) 纯函数计算，决定横幅文案与高亮
 *
 * 阶段 2 引入 zustand 后，第 1/2 步迁入 store，第 4 步改为 selector 订阅。
 */
function App() {
  const [initial] = useState(loadTrip)
  const trip = initial.trip
  const [saveFailed] = useState(() => !saveTrip(trip))

  // 调试时间旅行：偏移仅存内存，刷新即失效
  const [timeOffsetMs, setTimeOffsetMs] = useState(0)
  const [debugOpen, setDebugOpen] = useState(false)
  useKeySequence('time', () => setDebugOpen((open) => !open))

  const now = useNow(timeOffsetMs)
  // "今天"跟随虚构时间走，保证时间旅行时徽标与高亮一致
  const todayKey = getZonedDayKey(now, trip.timezone)
  const position = useMemo(() => getCurrentPosition(trip, now), [trip, now])

  return (
    <div className="app">
      {initial.resetReason !== null && (
        <div className="notice" role="alert">
          {initial.resetReason}
        </div>
      )}
      {saveFailed && (
        <div className="notice" role="alert">
          保存失败：浏览器本地存储不可用
        </div>
      )}
      <TripHeader trip={trip} />
      <StatusBanner trip={trip} position={position} />
      <main className="day-list">
        {trip.days.map((day) => (
          <DayView
            key={day.date}
            trip={trip}
            day={day}
            now={now}
            todayKey={todayKey}
            position={position}
          />
        ))}
      </main>
      <footer className="app-footer">数据仅保存在本浏览器 · 阶段 1 只读演示</footer>
      <DebugTimePanel
        open={debugOpen}
        offsetMs={timeOffsetMs}
        fakeNow={now}
        timeZone={trip.timezone}
        onChangeOffset={setTimeOffsetMs}
        onClose={() => setDebugOpen(false)}
      />
    </div>
  )
}

export default App
