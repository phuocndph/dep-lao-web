'use client'

import { create } from 'zustand'
import apiClient from '@/lib/api-client'

export interface ZaloAccount {
  id: string
  phone: string
  displayName: string
  status: 'connected' | 'qr_pending' | 'cookie_pending' | 'error' | 'inactive'
  connectedAt: string | null
}

interface QrModal {
  open: boolean
  accountId: string
  qrDataUrl: string
}

interface AccountsState {
  accounts: ZaloAccount[]
  isLoading: boolean
  qrModal: QrModal | null
  fetchAccounts: (tenantId: string) => Promise<void>
  addAccount: (phone: string) => Promise<ZaloAccount>
  removeAccount: (id: string) => Promise<void>
  updateStatus: (data: { accountId: string; status: ZaloAccount['status'] }) => void
  setQrModal: (data: QrModal | null) => void
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  isLoading: false,
  qrModal: null,

  fetchAccounts: async (tenantId) => {
    set({ isLoading: true })
    try {
      const accounts = await apiClient.get<ZaloAccount[]>(`/api/accounts?tenantId=${tenantId}`)
      set({ accounts })
    } finally {
      set({ isLoading: false })
    }
  },

  addAccount: async (phone) => {
    const account = await apiClient.post<ZaloAccount>('/api/accounts', { phone })
    set((s) => ({ accounts: [...s.accounts, account] }))
    return account
  },

  removeAccount: async (id) => {
    await apiClient.del(`/api/accounts/${id}`)
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }))
    if (get().qrModal?.accountId === id) set({ qrModal: null })
  },

  updateStatus: (data) => {
    set((s) => ({
      accounts: s.accounts.map((a) =>
        a.id === data.accountId ? { ...a, status: data.status } : a,
      ),
    }))
  },

  setQrModal: (data) => set({ qrModal: data }),
}))
