'use client'

import { create } from 'zustand'

export interface ChatMessage {
  id: string
  accountId: string
  threadId: string
  senderId: string
  content: string
  timestamp: number
}

interface ChatState {
  messages: ChatMessage[]
  addMessage: (msg: ChatMessage) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [msg, ...s.messages].slice(0, 500) })),
  clearMessages: () => set({ messages: [] }),
}))
