'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import ipc from '@/lib/ipc'
import { showConfirm } from '@/components/common/ConfirmDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuickMessage = {
  id: number | string
  keyword: string
  message: { title: string }
  media: null
  _local?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchLocalQuickMessages(): Promise<QuickMessage[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await ipc.db.getLocalQuickMessages() as any
  if (!res?.success) return []
  return res.items || []
}

// ─── Edit/Create Dialog ───────────────────────────────────────────────────────

function QuickMessageDialog({ initial, onClose, onSave }: {
  initial?: QuickMessage
  onClose: () => void
  onSave: (keyword: string, title: string) => Promise<void>
}) {
  const [keyword, setKeyword] = useState(initial?.keyword || '')
  const [title, setTitle] = useState(initial?.message?.title || '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleSave = async () => {
    if (!keyword.trim() || !title.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(keyword.trim(), title.trim())
      onClose()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Lưu thất bại')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose() }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[10000]">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-white font-semibold text-base">
            {initial ? 'Chỉnh sửa tin nhắn nhanh' : 'Tạo tin nhắn nhanh'}
          </h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700 transition-colors">✕</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-3 bg-gray-700 rounded-xl px-4 py-3 border border-gray-600 focus-within:border-blue-500 transition-colors">
            <div className="w-8 h-8 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-bold text-sm flex-shrink-0">/</div>
            <input autoFocus type="text" value={keyword}
              onChange={e => setKeyword(e.target.value.replace(/\s/g, '').slice(0, 20))}
              placeholder="ten_phim_tat"
              className="flex-1 bg-transparent text-white placeholder-gray-400 text-sm focus:outline-none" />
            <span className="text-xs text-gray-400 flex-shrink-0">{keyword.length}/20</span>
          </div>
          <textarea value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Nội dung tin nhắn nhanh..." rows={4}
            className="w-full bg-gray-700 border border-gray-600 focus:border-blue-500 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-400 resize-none focus:outline-none transition-colors" />
        </div>
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-gray-700 flex-shrink-0">
          {saveError && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">⚠ {saveError}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors">Hủy</button>
            <button onClick={handleSave} disabled={saving || !keyword.trim() || !title.trim()}
              className="px-6 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-2">
              {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Management Panel ─────────────────────────────────────────────────────────

export function QuickMessageManagerPanel({ onClose, onSelect }: {
  onClose: () => void
  onSelect?: (item: QuickMessage) => void
}) {
  const [items, setItems] = useState<QuickMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [editItem, setEditItem] = useState<QuickMessage | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (panelRef.current && panelRef.current.contains(target)) return
      if (target.closest?.('[data-qm-overlay]')) return
      onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 200)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler) }
  }, [onClose])

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await fetchLocalQuickMessages()) }
    catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleCreate = async (keyword: string, title: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ipc.db as any).upsertLocalQuickMessage({ item: { keyword, title } })
    await load()
  }

  const handleUpdate = async (keyword: string, title: string) => {
    if (!editItem) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ipc.db as any).upsertLocalQuickMessage({ item: { id: editItem.id, keyword, title } })
    await load()
  }

  const handleDelete = async (item: QuickMessage) => {
    const ok = await showConfirm({
      title: `Xóa tin nhắn nhanh "/${item.keyword}"?`,
      message: 'Hành động này không thể hoàn tác.',
      confirmText: 'Xóa',
      variant: 'danger',
    })
    if (!ok) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ipc.db as any).deleteLocalQuickMessage({ id: item.id })
    await load()
  }

  return (
    <>
      <div
        ref={panelRef}
        className="fixed w-[360px] max-h-[520px] bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-[9999]"
        style={{
          left: '50%',
          bottom: '80px',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateX(-50%) translateY(0px)' : 'translateX(-50%) translateY(10px)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <span className="text-sm font-semibold text-white">Tin nhắn nhanh</span>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-700 transition-colors text-sm">✕</button>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/60 flex-shrink-0 bg-gray-800/80">
          <button onClick={() => void load()} disabled={loading} title="Làm mới"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-40">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
          <button onClick={() => { setEditItem(undefined); setShowDialog(true) }}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Tạo mới
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-500 text-xs gap-2 px-4 text-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-600">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              Chưa có tin nhắn nhanh nào.
            </div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {items.map(item => (
                <div
                  key={String(item.id)}
                  onClick={() => { onSelect?.(item); onClose() }}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-700/50 group transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <span className="inline-block bg-gray-700 text-white text-xs font-semibold px-2 py-0.5 rounded-md mb-1.5">/{item.keyword}</span>
                    <p className="text-sm text-gray-300 leading-relaxed line-clamp-2">{item.message.title}</p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditItem(item); setShowDialog(true) }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(item) }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-2.5 border-t border-gray-700/60 flex-shrink-0 text-xs text-green-400/70">
          ✓ Local — lưu trên server, không cần tài khoản Zalo API
        </div>
      </div>

      {showDialog && (
        <QuickMessageDialog
          initial={editItem}
          onClose={() => { setShowDialog(false); setEditItem(undefined) }}
          onSave={editItem ? handleUpdate : handleCreate}
        />
      )}
    </>
  )
}

// ─── Quick Message Dropdown ───────────────────────────────────────────────────

export function QuickMessageDropdown({ items, filter, selectedIdx, onSelect, onManage }: {
  items: QuickMessage[]
  filter: string
  selectedIdx: number
  onSelect: (item: QuickMessage) => void
  onManage: () => void
}) {
  const filtered = filter
    ? items.filter(i =>
        i.keyword.toLowerCase().startsWith(filter.toLowerCase()) ||
        i.keyword.toLowerCase().includes(filter.toLowerCase()) ||
        i.message.title.toLowerCase().includes(filter.toLowerCase())
      )
    : items

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl overflow-hidden"
      style={{ maxHeight: '20rem', display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs font-semibold text-white">Tin nhắn nhanh ({filtered.length})</span>
        <button onMouseDown={e => { e.preventDefault(); onManage() }}
          className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors">Quản lý</button>
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">Không tìm thấy tin nhắn nhanh</p>
        ) : (
          filtered.map((item, idx) => (
            <button key={String(item.id)} onMouseDown={e => { e.preventDefault(); onSelect(item) }}
              className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-700/40 last:border-0 ${idx === selectedIdx ? 'bg-gray-700' : 'hover:bg-gray-700/60'}`}>
              <span className="inline-block bg-gray-700 text-white text-xs font-semibold px-2 py-0.5 rounded-md mb-1">/{item.keyword}</span>
              <p className="text-sm text-gray-300 truncate leading-snug">{item.message.title}</p>
            </button>
          ))
        )}
      </div>
      <div className="px-4 py-2 border-t border-gray-700 flex-shrink-0 bg-gray-800/80">
        <p className="text-xs text-gray-500">
          Gợi ý: Nhập <kbd className="bg-gray-700 text-gray-300 text-xs px-1.5 py-0.5 rounded">/</kbd> để hiển thị danh sách tin nhắn nhanh.
        </p>
      </div>
    </div>
  )
}

// ─── Hook to fetch quick messages ─────────────────────────────────────────────

export function useQuickMessages() {
  const [items, setItems] = useState<QuickMessage[]>([])

  useEffect(() => {
    fetchLocalQuickMessages().then(setItems).catch(() => {})
  }, [])

  return items
}
