'use client'

import { create } from 'zustand'
import apiClient from '@/lib/api-client'
import { setTokens, clearTokens, getRefreshToken } from '@/lib/auth'
import { connectSocket, disconnectSocket } from '@/lib/socket-client'

interface AuthUser {
  id: string
  email: string
  displayName: string
  role: string
  tenantId: string
}

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, tenantSlug: string) => Promise<void>
  register: (dto: {
    email: string
    password: string
    displayName: string
    tenantName: string
    tenantSlug: string
  }) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,

  login: async (email, password, tenantSlug) => {
    set({ isLoading: true })
    try {
      const res = await apiClient.post<{
        accessToken: string
        refreshToken: string
        user: AuthUser
      }>('/auth/login', { email, password, tenantSlug })
      setTokens(res.accessToken, res.refreshToken)
      set({ user: res.user, isAuthenticated: true })
      connectSocket()
    } finally {
      set({ isLoading: false })
    }
  },

  register: async (dto) => {
    set({ isLoading: true })
    try {
      const res = await apiClient.post<{
        accessToken: string
        refreshToken: string
        user: AuthUser
      }>('/auth/register', dto)
      setTokens(res.accessToken, res.refreshToken)
      set({ user: res.user, isAuthenticated: true })
      connectSocket()
    } finally {
      set({ isLoading: false })
    }
  },

  logout: async () => {
    set({ isLoading: true })
    try {
      const refreshToken = getRefreshToken()
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => {})
      }
    } finally {
      clearTokens()
      set({ user: null, isAuthenticated: false, isLoading: false })
      disconnectSocket()
    }
  },

  fetchMe: async () => {
    set({ isLoading: true })
    try {
      const user = await apiClient.get<AuthUser>('/auth/me')
      set({ user, isAuthenticated: true })
      connectSocket()
    } catch {
      clearTokens()
      set({ user: null, isAuthenticated: false })
    } finally {
      set({ isLoading: false })
    }
  },
}))
