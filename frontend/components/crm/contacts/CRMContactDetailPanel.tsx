'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { CRMContact, CRMNote, WebLabel } from '@/stores/crmStore'
import ipc from '@/lib/ipc'
import ZaloLabelSelector from '../tags/ZaloLabelSelector'
import ZaloLabelBadge from '../tags/ZaloLabelBadge'
import NoteList from '../notes/NoteList'

interface CRMContactDetailPanelProps {
  contact: CRMContact
  allLabels: WebLabel[]
  onClose: () => void
  onLabelToggle: (contactId: string, labelId: string, assigned: boolean) => Promise<void>
}

export default function CRMContactDetailPanel({ contact, allLabels, onClose, onLabelToggle }: CRMContactDetailPanelProps) {
  const [notes, setNotes] = useState<CRMNote[]>([])
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(contact.labels.map((l) => l.id))
  const [labelsDirty, setLabelsDirty] = useState(false)
  const [savingLabels, setSavingLabels] = useState(false)
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showNotification = (msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 2500)
  }

  const loadNotes = useCallback(async () => {
    const res = await ipc.crm.getNotes({ contactId: contact.contact_id })
    if (res.success) setNotes(res.notes)
  }, [contact.contact_id])

  useEffect(() => {
    loadNotes()
    // Re-sync label selection when contact changes
    setSelectedLabelIds(contact.labels.map((l) => l.id))
    setLabelsDirty(false)
  }, [contact.contact_id, loadNotes])

  const handleSaveLabels = async () => {
    setSavingLabels(true)
    try {
      const originalIds = contact.labels.map((l) => l.id)
      const toAdd = selectedLabelIds.filter((id) => !originalIds.includes(id))
      const toRemove = originalIds.filter((id) => !selectedLabelIds.includes(id))

      for (const labelId of toAdd) {
        await onLabelToggle(contact.contact_id, labelId, true)
      }
      for (const labelId of toRemove) {
        await onLabelToggle(contact.contact_id, labelId, false)
      }

      setLabelsDirty(false)
      showNotification('Đã cập nhật nhãn', 'success')
    } catch {
      showNotification('Không thể cập nhật nhãn', 'error')
    }
    setSavingLabels(false)
  }

  const handleSaveNote = async (content: string, id?: string) => {
    // TODO: id-based update creates a new note instead — implement PUT endpoint in Phase 6+
    await ipc.crm.saveNote({ note: { id, contact_id: contact.contact_id, content } })
    await loadNotes()
  }

  const handleDeleteNote = async (noteId: string) => {
    await ipc.crm.deleteNote({ noteId, contactId: contact.contact_id })
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
  }

  const name = contact.alias || contact.display_name || contact.contact_id

  return (
    <div className="w-80 flex-shrink-0 flex flex-col bg-gray-850 border-l border-gray-700 h-full relative">
      {/* Inline notification */}
      {notification && (
        <div className={`absolute top-2 left-2 right-2 z-50 px-3 py-2 rounded-lg text-xs text-white ${notification.type === 'success' ? 'bg-green-600/90' : 'bg-red-600/90'}`}>
          {notification.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-white flex-1 truncate">{name}</span>
      </div>

      {/* Avatar + basic info */}
      <div className="flex flex-col items-center gap-2 px-4 py-4 border-b border-gray-700">
        {contact.avatar
          ? <img src={contact.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
          : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
              {(name || 'U').charAt(0).toUpperCase()}
            </div>
          )}
        <div className="text-center">
          <p className="text-white font-semibold text-sm">{name}</p>
          {contact.alias && contact.alias !== contact.display_name && (
            <p className="text-xs text-gray-400">({contact.display_name})</p>
          )}
          {contact.phone && <p className="text-xs text-gray-500 mt-0.5">{contact.phone}</p>}
          {contact.zalo_uid && <p className="text-[11px] text-gray-600 mt-0.5">UID: {contact.zalo_uid}</p>}
        </div>
        {/* Current label pills */}
        {contact.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-center">
            {contact.labels.map((l) => <ZaloLabelBadge key={l.id} label={l} size="xs" />)}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Labels */}
        <p className="text-xs text-gray-400 font-medium">Nhãn</p>
        {allLabels.length === 0 ? (
          <p className="text-xs text-gray-500">Chưa có nhãn nào. Tạo nhãn tại trang Quản lý nhãn.</p>
        ) : (
          <ZaloLabelSelector
            allLabels={allLabels}
            selectedIds={selectedLabelIds}
            onChange={(ids) => { setSelectedLabelIds(ids); setLabelsDirty(true) }}
          />
        )}
        {labelsDirty && (
          <button
            onClick={handleSaveLabels}
            disabled={savingLabels}
            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-50"
          >
            {savingLabels ? 'Đang lưu...' : 'Lưu nhãn'}
          </button>
        )}

        {/* Notes */}
        <p className="text-xs text-gray-400 font-medium">Ghi chú</p>
        <NoteList notes={notes} onSave={handleSaveNote} onDelete={handleDeleteNote} />
      </div>
    </div>
  )
}
