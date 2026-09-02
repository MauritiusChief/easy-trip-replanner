import { useEffect, useRef } from 'react'

/**
 * 监听全局键盘输入，当最近连续敲击的字母恰好组成 sequence 时触发 onMatch。
 *
 * 规则：
 * - 只统计长度为 1 的可打印字符（忽略 Shift、方向键等），大小写不敏感
 * - 忽略带 Ctrl/Alt/Meta 修饰键的组合键
 * - 忽略输入框、文本域、下拉框与可编辑元素中的按键，避免干扰正常输入
 * - 用滑动窗口保存最近 sequence.length 个字符，匹配后清空防止连触
 *
 * 用于调试面板的 "time" 暗号开关。
 */
export function useKeySequence(sequence: string, onMatch: () => void): void {
  const onMatchRef = useRef(onMatch)
  // 最新回调经 effect 同步，避免渲染期写 ref
  useEffect(() => {
    onMatchRef.current = onMatch
  }, [onMatch])
  useEffect(() => {
    let buffer = ''
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (event.key.length !== 1) return
      buffer = (buffer + event.key.toLowerCase()).slice(-sequence.length)
      if (buffer === sequence) {
        buffer = ''
        onMatchRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sequence])
}
