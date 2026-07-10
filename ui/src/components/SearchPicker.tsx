import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type SearchPickerProps<T> = {
  id: string
  label: string
  placeholder?: string
  query: string
  onQueryChange: (query: string) => void
  items: T[]
  getKey: (item: T) => string
  /** Label written into the search field after a selection. Defaults to getKey. */
  getLabel?: (item: T) => string
  renderItem: (item: T) => ReactNode
  selectedKey: string | null
  onSelect: (item: T) => void
  emptyMessage?: string
  disabled?: boolean
}

export default function SearchPicker<T>({
  id,
  label,
  placeholder,
  query,
  onQueryChange,
  items,
  getKey,
  getLabel,
  renderItem,
  selectedKey,
  onSelect,
  emptyMessage = 'No matches',
  disabled = false,
}: SearchPickerProps<T>) {
  const [open, setOpen] = useState(false)

  const close = () => setOpen(false)

  const handleSelect = (item: T) => {
    onSelect(item)
    onQueryChange((getLabel ?? getKey)(item))
    close()
  }

  return (
    <div className="search-picker">
      <Label htmlFor={id}>{label}</Label>
      <div className="search-picker-field">
        <Input
          id={id}
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // ponytail: defer so mousedown on list item runs before close
            window.setTimeout(() => setOpen(false), 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
        />
        {open && (
          <div
            className="search-picker-list"
            id={`${id}-list`}
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="search-picker-scroll">
              {items.length === 0 ? (
                <p className="search-picker-empty">{emptyMessage}</p>
              ) : (
                items.map((item) => {
                  const key = getKey(item)
                  const selected = key === selectedKey
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn('search-picker-item', selected && 'search-picker-item--selected')}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelect(item)
                      }}
                    >
                      {renderItem(item)}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
