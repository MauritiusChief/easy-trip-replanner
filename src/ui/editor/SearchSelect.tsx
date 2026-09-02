import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import './SearchSelect.css'

export interface SearchSelectOption {
  value: string
  label: string
}

interface SearchSelectProps {
  value: string
  options: SearchSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
}

/**
 * 可输入字符串搜索的下拉选择（替代原生 select）：
 * - 聚焦/输入时在输入框下方展开筛选列表（文档流内展开，带滚动上限，
 *   避免选项过长撑出屏幕或被底部抽屉裁剪）
 * - 点击选项、或键盘 ↑↓ + Enter 选中；Esc 关闭；失焦还原显示当前选中项
 * - 空查询显示全部选项，查询按子串不区分大小写过滤
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
}: SearchSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const normalized = query.trim().toLowerCase()
  const filtered =
    normalized === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(normalized))

  const openList = () => {
    setQuery('')
    setActiveIndex(-1)
    setOpen(true)
  }

  const commit = (option: SearchSelectOption) => {
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        openList()
        event.preventDefault()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
      event.preventDefault()
    } else if (event.key === 'ArrowUp') {
      setActiveIndex((index) => Math.max(index - 1, 0))
      event.preventDefault()
    } else if (event.key === 'Enter') {
      const option = filtered[activeIndex] ?? filtered[0]
      if (option) commit(option)
      event.preventDefault()
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="search-select">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(-1)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul className="search-select-list" role="listbox" aria-label={ariaLabel}>
          {filtered.length === 0 && <li className="search-select-empty">无匹配选项</li>}
          {filtered.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`search-select-item${index === activeIndex ? ' is-active' : ''}${
                  option.value === value ? ' is-selected' : ''
                }`}
                /* mousedown 先于输入框 blur 触发，保证点击选中生效 */
                onMouseDown={(event) => {
                  event.preventDefault()
                  commit(option)
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
