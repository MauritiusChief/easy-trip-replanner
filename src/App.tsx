import { useMemo, useState } from 'react'
import { getCurrentPosition } from './domain/current'
import { getZonedDayKey } from './domain/time'
import { useKeySequence } from './state/useKeySequence'
import { useNow } from './state/useNow'
import { useTripStore } from './state/tripStore'
import { DebugTimePanel } from './ui/DebugTimePanel'
import { DayView } from './ui/DayView'
import { StatusBanner } from './ui/StatusBanner'
import { TripHeader } from './ui/TripHeader'
import { EditorSheet } from './ui/editor/EditorSheet'

/**
 * 应用壳（阶段 2）：
 * 1. 行程数据来自 zustand store（加载/校验/回退/自动持久化都在 store 内完成）
 * 2. 时钟：useNow 每 30 秒刷新，可被调试面板的时间偏移虚构
 * 3. 位置推导：getCurrentPosition(trip, now) 纯函数计算，决定横幅文案与高亮
 * 4. 编辑：点击 slot 打开底部抽屉表单，保存后写回 store 并自动持久化
 */
function App() {
  const trip = useTripStore((state) => state.trip)
  const resetReason = useTripStore((state) => state.resetReason)
  const saveFailed = useTripStore((state) => state.saveFailed)

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
      {resetReason !== null && (
        <div className="notice" role="alert">
          {resetReason}
        </div>
      )}
      {saveFailed && (
        <div className="notice" role="alert">
          保存失败：浏览器本地存储不可用，编辑不会保留
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
      <footer className="app-footer">数据仅保存在本浏览器</footer>
      <DebugTimePanel
        open={debugOpen}
        offsetMs={timeOffsetMs}
        fakeNow={now}
        timeZone={trip.timezone}
        onChangeOffset={setTimeOffsetMs}
        onClose={() => setDebugOpen(false)}
      />
      <EditorSheet />
    </div>
  )
}

export default App
