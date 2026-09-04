import { describe, expect, it } from 'vitest'
import { buildStandardReorderTrip } from '../test/standardReorderTrip'
import { exportTripJson, getTripExportFilename, importTripJson } from './transfer'

describe('行程 JSON 传输', () => {
  it('导出的完整行程可再次导入', () => {
    const trip = buildStandardReorderTrip()

    expect(importTripJson(exportTripJson(trip))).toEqual(trip)
  })

  it('拒绝无法解析或不符合当前版本的文件', () => {
    expect(importTripJson('{')).toBeNull()
    expect(importTripJson(JSON.stringify({ schemaVersion: 1 }))).toBeNull()
  })

  it('按行程名称生成可用的 JSON 文件名', () => {
    expect(getTripExportFilename('东京/京都之旅')).toBe('东京_京都之旅.json')
    expect(getTripExportFilename('行程.json')).toBe('行程.json')
  })
})
