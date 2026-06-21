'use client'

import { create } from 'zustand'

// ─── Web-native types ─────────────────────────────────────────────────────────
// These replace the Electron desktop types with web-compatible equivalents.
// Labels use UUID strings (not number IDs). Notes use UUID strings.

export interface WebLabel {
  id: string    // UUID from DB
  name: string
  color: string
  emoji?: string
}

export interface CRMContact {
  contact_id: string       // UUID (Contact.id in DB)
  zalo_uid: string         // Contact.zaloUid
  display_name: string
  alias: string            // realName or empty
  avatar: string
  phone: string
  contact_type: string     // 'friend' | 'group' (always 'friend' in web for now)
  last_message_time: number
  note_count: number
  labels: WebLabel[]
}

export interface CRMNote {
  id: string               // UUID (ContactNote.id in DB) — string, not number like desktop
  contact_id: string
  content: string
  created_at: number       // ms timestamp
  updated_at: number       // ms timestamp
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface CRMStore {
  contacts: CRMContact[]
  totalContacts: number
  selectedContactIds: Set<string>
  activeContactId: string | null
  searchText: string
  filterLabelIds: string[]  // UUID strings in web (not number[] like desktop)
  sortBy: 'name' | 'last_message'
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
  contactsLoading: boolean

  setContacts: (contacts: CRMContact[], total: number) => void
  toggleSelectContact: (id: string) => void
  selectAllContacts: (ids: string[]) => void
  clearSelection: () => void
  setActiveContact: (id: string | null) => void
  setFilter: (f: Partial<Pick<CRMStore, 'searchText' | 'filterLabelIds' | 'sortBy' | 'sortDir' | 'page'>>) => void
  setContactsLoading: (v: boolean) => void
}

export const useCRMStore = create<CRMStore>((set) => ({
  contacts: [],
  totalContacts: 0,
  selectedContactIds: new Set(),
  activeContactId: null,
  searchText: '',
  filterLabelIds: [],
  sortBy: 'name',
  sortDir: 'asc',
  page: 0,
  pageSize: 100,
  contactsLoading: false,

  setContacts: (contacts, totalContacts) => set({ contacts, totalContacts }),
  toggleSelectContact: (id) => set((s) => {
    const next = new Set(s.selectedContactIds)
    next.has(id) ? next.delete(id) : next.add(id)
    return { selectedContactIds: next }
  }),
  selectAllContacts: (ids) => set({ selectedContactIds: new Set(ids) }),
  clearSelection: () => set({ selectedContactIds: new Set() }),
  setActiveContact: (id) => set({ activeContactId: id }),
  setFilter: (f) => set((s) => ({ ...s, ...f, page: f.page ?? 0 })),
  setContactsLoading: (v) => set({ contactsLoading: v }),
}))
