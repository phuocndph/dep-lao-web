'use client'

import React, { useEffect, useCallback, useState } from 'react'
import { useCRMStore } from '@/stores/crmStore'
import type { WebLabel } from '@/stores/crmStore'
import ipc from '@/lib/ipc'
import CRMContactList from './contacts/CRMContactList'
import CRMContactDetailPanel from './contacts/CRMContactDetailPanel'
import BulkActionBar from './contacts/BulkActionBar'

// ── Label management panel ───────────────────────────────────────────────────
function LabelManagerModal({ labels, onClose, onCreated, onDeleted }: {
  labels: WebLabel[]
  onClose: () => void
  onCreated: (label: WebLabel) => void
  onDeleted: (id: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const res = await ipc.crm.addLabel(newName.trim(), newColor)
    if (res.success && res.label) onCreated(res.label)
    setNewName('')
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    await ipc.crm.deleteLabel?.(id)
    onDeleted(id)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-600 rounded-2xl w-80 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white mb-3">Quản lý nhãn</h3>

        {/* Create */}
        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên nhãn..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs disabled:opacity-40"
          >
            Thêm
          </button>
        </div>

        {/* List */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {labels.length === 0 && <p className="text-xs text-gray-500 text-center py-2">Chưa có nhãn nào</p>}
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-2 py-1.5 bg-gray-700/50 rounded-lg">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
              <span className="flex-1 text-sm text-white">{l.name}</span>
              <button onClick={() => handleDelete(l.id)} className="text-[11px] text-red-400 hover:text-red-300">Xóa</button>
            </div>
          ))}
        </div>

        <button onClick={onClose} className="w-full mt-4 py-2 rounded-xl bg-gray-700 text-gray-300 text-sm hover:bg-gray-600">
          Đóng
        </button>
      </div>
    </div>
  )
}

// ── Bulk label modal ──────────────────────────────────────────────────────────
function BulkLabelModal({ allLabels, selectedCount, onClose, onApply }: {
  allLabels: WebLabel[]
  selectedCount: number
  onClose: () => void
  onApply: (labelId: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const handleApply = async () => {
    if (!selected) return
    setApplying(true)
    await onApply(selected)
    setApplying(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-600 rounded-2xl w-72 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white mb-1">Gán nhãn</h3>
        <p className="text-xs text-gray-400 mb-3">Áp dụng cho <span className="text-blue-400">{selectedCount}</span> liên hệ</p>
        <div className="space-y-1 max-h-44 overflow-y-auto mb-4">
          {allLabels.length === 0 && <p className="text-xs text-gray-500 text-center py-3">Chưa có nhãn nào</p>}
          {allLabels.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelected(selected === l.id ? null : l.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${selected === l.id ? 'bg-blue-600/20 border border-blue-500' : 'border border-transparent hover:bg-gray-700'}`}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
              <span className="text-sm text-white">{l.name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-gray-700 text-gray-300 text-sm hover:bg-gray-600">Hủy</button>
          <button onClick={handleApply} disabled={!selected || applying} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-40">
            {applying ? 'Đang gán...' : 'Áp dụng'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main CRMPage ─────────────────────────────────────────────────────────────
export default function CRMPage() {
  const store = useCRMStore()
  const [allLabels, setAllLabels] = useState<WebLabel[]>([])
  const [showLabelManager, setShowLabelManager] = useState(false)
  const [showBulkLabel, setShowBulkLabel] = useState(false)

  // Load labels
  const loadLabels = useCallback(async () => {
    const res = await ipc.crm.getLabels()
    if (res.success) setAllLabels(res.labels)
  }, [])

  // Load contacts
  const loadContacts = useCallback(async () => {
    store.setContactsLoading(true)
    const res = await ipc.crm.getContacts({
      opts: {
        search: store.searchText || undefined,
        limit: store.pageSize,
        offset: store.page * store.pageSize,
      },
    })
    store.setContactsLoading(false)
    if (res.success) {
      // Client-side label filter (API doesn't support multi-label filter yet)
      let contacts = res.contacts
      if (store.filterLabelIds.length > 0) {
        contacts = contacts.filter((c) => store.filterLabelIds.every((lid) => c.labels.some((l) => l.id === lid)))
      }
      store.setContacts(contacts, store.filterLabelIds.length > 0 ? contacts.length : res.total)
    }
  }, [store.searchText, store.page, store.filterLabelIds])

  useEffect(() => { loadLabels() }, [])
  useEffect(() => { loadContacts() }, [store.searchText, store.page, store.filterLabelIds])

  const activeContact = store.contacts.find((c) => c.contact_id === store.activeContactId) || null

  const handleLabelToggle = async (contactId: string, labelId: string, assigned: boolean) => {
    if (assigned) {
      await ipc.crm.assignLabel(contactId, labelId)
    } else {
      await ipc.crm.removeLabel(contactId, labelId)
    }
    // Refresh contacts to reflect label change
    await loadContacts()
  }

  const handleBulkLabel = async (labelId: string) => {
    const ids = [...store.selectedContactIds]
    for (const contactId of ids) {
      await ipc.crm.assignLabel(contactId, labelId)
    }
    store.clearSelection()
    await loadContacts()
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-700 flex-shrink-0">
        <span className="text-sm font-semibold text-white">👤 Liên hệ</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowLabelManager(true)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-700/60 transition-colors border border-gray-700"
        >
          🏷️ Quản lý nhãn
        </button>
        <button
          onClick={loadContacts}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-700/60 transition-colors"
          title="Làm mới"
        >
          ↺
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <CRMContactList
            contacts={store.contacts}
            total={store.totalContacts}
            page={store.page}
            pageSize={store.pageSize}
            loading={store.contactsLoading}
            selectedIds={store.selectedContactIds}
            activeContactId={store.activeContactId}
            allLabels={allLabels}
            filterLabelIds={store.filterLabelIds}
            searchText={store.searchText}
            sortBy={store.sortBy}
            sortDir={store.sortDir}
            onSelectContact={store.toggleSelectContact}
            onActivateContact={(id) => store.setActiveContact(store.activeContactId === id ? null : id)}
            onSelectAll={() => store.selectAllContacts(store.contacts.map((c) => c.contact_id))}
            onClearAll={store.clearSelection}
            onFilterChange={(f) => store.setFilter(f as Parameters<typeof store.setFilter>[0])}
            onPageChange={(p) => store.setFilter({ page: p })}
          />
        </div>

        {/* Detail panel */}
        {activeContact && (
          <CRMContactDetailPanel
            contact={activeContact}
            allLabels={allLabels}
            onClose={() => store.setActiveContact(null)}
            onLabelToggle={handleLabelToggle}
          />
        )}
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={store.selectedContactIds.size}
        onClearSelection={store.clearSelection}
        onBulkTagLabel={() => setShowBulkLabel(true)}
      />

      {/* Modals */}
      {showLabelManager && (
        <LabelManagerModal
          labels={allLabels}
          onClose={() => setShowLabelManager(false)}
          onCreated={(label) => setAllLabels((prev) => [...prev, label])}
          onDeleted={(id) => { setAllLabels((prev) => prev.filter((l) => l.id !== id)); loadContacts() }}
        />
      )}

      {showBulkLabel && (
        <BulkLabelModal
          allLabels={allLabels}
          selectedCount={store.selectedContactIds.size}
          onClose={() => setShowBulkLabel(false)}
          onApply={handleBulkLabel}
        />
      )}
    </div>
  )
}
