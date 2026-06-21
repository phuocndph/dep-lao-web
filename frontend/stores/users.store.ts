'use client'

import { create } from 'zustand'
import apiClient from '@/lib/api-client'

export interface TenantUser {
  id: string
  email: string
  displayName: string
  role: string
  isActive: boolean
  createdAt: string
}

interface UsersState {
  users: TenantUser[]
  isLoading: boolean
  fetchUsers: () => Promise<void>
  createUser: (dto: { email: string; password: string; displayName: string; role?: string }) => Promise<TenantUser>
  deleteUser: (id: string) => Promise<void>
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],
  isLoading: false,

  fetchUsers: async () => {
    set({ isLoading: true })
    try {
      const users = await apiClient.get<TenantUser[]>('/api/users')
      set({ users })
    } finally {
      set({ isLoading: false })
    }
  },

  createUser: async (dto) => {
    const user = await apiClient.post<TenantUser>('/api/users', dto)
    set((s) => ({ users: [...s.users, user] }))
    return user
  },

  deleteUser: async (id) => {
    await apiClient.del(`/api/users/${id}`)
    set((s) => ({ users: s.users.map((u) => (u.id === id ? { ...u, isActive: false } : u)) }))
  },
}))
