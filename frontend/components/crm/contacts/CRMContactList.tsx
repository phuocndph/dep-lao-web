'use client'

import React, { useRef, useState, useEffect } from 'react'
import type { CRMContact, WebLabel } from '@/stores/crmStore'
import ZaloLabelBadge from '../tags/ZaloLabelBadge'

interface CRMContactListProps {
  contacts: CRMContact[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  selectedIds: Set<string>
  activeContactId: string | null
  allLabels: WebLabel[]
  filterLabelIds: string[]
  searchText: string
  sortBy: 'name' | 'last_message'
  sortDir: 'asc' | 'desc'
  onSelectContact: (id: string) => void
  onActivateContact: (id: string) => void
  onSelectAll: () => void
  onClearAll: () => void
  onFilterChange: (f: Record<string, unknown>) => void
  onPageChange: (page: number) => void
}

// ── Label filter dropdown ─────────────────────────────────────────────────────
function LabelFilterDropdown({ allLabels, filterLabelIds, onChange }: {
  allLabels: WebLabel[]
  filterLabelIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggle = (id: string) =>
    onChange(filterLabelIds.includes(id) ? filterLabelIds.filter((x) => x !== id) : [...filterLabelIds, id])

  const activeCount = filterLabelIds.length

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
          activeCount > 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-600 text-gray-400 hover:border-gray-500'
        }`}
      >
        🏷️ {activeCount > 0 ? `${activeCount} nhãn` : 'Nhãn'}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-xl shadow-xl z-50 min-w-[180px] max-h-64 overflow-y-auto">
          {allLabels.length === 0 && (
            <p className="text-xs text-gray-500 px-3 py-2">Chưa có nhãn nào</p>
          )}
          {allLabels.map((label) => (
            <button
              key={label.id}
              onClick={() => toggle(label.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 text-left transition-colors"
            >
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[11px] ${filterLabelIds.includes(label.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-500'}`}>
                {filterLabelIds.includes(label.id) && '✓'}
              </span>
              <ZaloLabelBadge label={label} size="xs" />
            </button>
          ))}
          {activeCount > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-xs text-gray-400 hover:text-white px-3 py-2 border-t border-gray-700 text-left"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────
function SortDropdown({ sortBy, sortDir, onChange }: {
  sortBy: string
  sortDir: string
  onChange: (sortBy: string, sortDir: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const OPTIONS = [
    { key: 'name:asc', label: 'Tên A → Z' },
    { key: 'name:desc', label: 'Tên Z → A' },
    { key: 'last_message:desc', label: 'Tin nhắn gần nhất' },
  ]
  const current = `${sortBy}:${sortDir}`
  const currentLabel = OPTIONS.find((o) => o.key === current)?.label || 'Sắp xếp'

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-gray-600 text-gray-400 hover:border-gray-500 transition-colors"
      >
        ↕️ {currentLabel}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-xl shadow-xl z-50 min-w-[180px] overflow-hidden">
          {OPTIONS.map((opt) => {
            const isActive = current === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => { const [sb, sd] = opt.key.split(':'); onChange(sb, sd); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-700 text-left transition-colors"
              >
                <span className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center text-[11px] ${isActive ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-500'}`}>
                  {isActive && '●'}
                </span>
                <span className="text-xs text-gray-200">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CRMContactList({
  contacts, total, page, pageSize, loading,
  selectedIds, activeContactId,
  allLabels, filterLabelIds, searchText,
  sortBy, sortDir,
  onSelectContact, onActivateContact,
  onSelectAll, onClearAll,
  onFilterChange, onPageChange,
}: CRMContactListProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const allOnPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.contact_id))

  return (
    <div className="flex flex-col h-full">
      {/* Search + filters */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 flex-shrink-0 flex-wrap gap-y-2">
        <input
          value={searchText}
          onChange={(e) => onFilterChange({ searchText: e.target.value, page: 0 })}
          placeholder="Tìm tên, SĐT, UID..."
          className="flex-1 min-w-[140px] bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <LabelFilterDropdown
          allLabels={allLabels}
          filterLabelIds={filterLabelIds}
          onChange={(ids) => onFilterChange({ filterLabelIds: ids, page: 0 })}
        />
        <SortDropdown
          sortBy={sortBy}
          sortDir={sortDir}
          onChange={(sb, sd) => onFilterChange({ sortBy: sb, sortDir: sd, page: 0 })}
        />
      </div>

      {/* Column header */}
      <div className="flex items-center px-4 py-2 border-b border-gray-700/50 text-[11px] text-gray-500 flex-shrink-0">
        <input
          type="checkbox"
          checked={allOnPageSelected}
          onChange={allOnPageSelected ? onClearAll : onSelectAll}
          className="mr-3 cursor-pointer accent-blue-500"
        />
        <span className="flex-1">Tên ({total})</span>
        <span className="w-24 text-right">SĐT</span>
        <span className="w-16 text-right">Nhãn</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-24 text-gray-500 text-sm">Đang tải...</div>
        )}
        {!loading && contacts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500 gap-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p className="text-sm">Không có liên hệ nào</p>
            {(searchText || filterLabelIds.length > 0) && (
              <button onClick={() => onFilterChange({ searchText: '', filterLabelIds: [], page: 0 })} className="text-xs text-blue-400 hover:text-blue-300">
                Xóa bộ lọc
              </button>
            )}
          </div>
        )}
        {!loading && contacts.map((contact) => {
          const isSelected = selectedIds.has(contact.contact_id)
          const isActive = activeContactId === contact.contact_id
          const name = contact.alias || contact.display_name || contact.contact_id

          return (
            <div
              key={contact.contact_id}
              onClick={() => onActivateContact(contact.contact_id)}
              className={`flex items-center px-4 py-2.5 cursor-pointer border-b border-gray-700/30 hover:bg-gray-700/50 transition-colors ${isActive ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelectContact(contact.contact_id)}
                onClick={(e) => e.stopPropagation()}
                className="mr-3 cursor-pointer accent-blue-500 flex-shrink-0"
              />
              {/* Avatar */}
              {contact.avatar
                ? <img src={contact.avatar} alt="" className="w-8 h-8 rounded-full object-cover mr-2.5 flex-shrink-0" />
                : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold mr-2.5 flex-shrink-0">
                    {(name || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              {/* Name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{name}</p>
                {contact.note_count > 0 && (
                  <p className="text-[11px] text-gray-500">📝 {contact.note_count} ghi chú</p>
                )}
              </div>
              {/* Phone */}
              <span className="w-24 text-right text-xs text-gray-400 truncate flex-shrink-0">
                {contact.phone || '—'}
              </span>
              {/* Labels */}
              <div className="w-16 flex justify-end gap-0.5 flex-shrink-0">
                {contact.labels.slice(0, 2).map((l) => (
                  <span key={l.id} className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} title={l.name} />
                ))}
                {contact.labels.length > 2 && <span className="text-[10px] text-gray-500">+{contact.labels.length - 2}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-t border-gray-700 text-xs text-gray-400 flex-shrink-0">
          <button
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
          >
            ‹
          </button>
          <span>Trang {page + 1} / {totalPages}</span>
          <button
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
