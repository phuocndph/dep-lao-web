'use client'

/**
 * chatStore.ts — Desktop-compatible chat store for the web.
 *
 * Interface is deliberately kept close to the Deplao desktop chatStore so
 * that components can be ported with minimal changes.  Key differences:
 *   - No SQLite / ipc.db.*  — contacts & messages live in memory only.
 *   - Drafts use localStorage instead of SQLite.
 *   - The `channel` field (zalo/facebook) is omitted — only Zalo for now.
 */

import { create } from 'zustand'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReactionEmoji {
  total: number
  users: Record<string, number>
}

export interface ReactionData {
  total: number
  lastReact: string
  emoji: Record<string, ReactionEmoji>
}

export interface MessageItem {
  id?: number
  msg_id: string
  cli_msg_id?: string
  /** UUID of the Zalo account that owns this message (= accountId in backend) */
  owner_zalo_id: string
  thread_id: string
  thread_type: number
  sender_id: string
  content: string
  msg_type: string
  timestamp: number
  is_sent: number
  attachments?: string
  local_paths?: string
  status: string
  is_recalled?: number
  recalled_content?: string | null
  reactions?: ReactionData | Record<string, string> | string
  quote_data?: string
  reply_to_id?: string | null
  handled_by_employee?: string | null
}

export interface ContactItem {
  id?: number
  owner_zalo_id: string
  contact_id: string
  display_name: string
  alias?: string
  avatar_url: string
  phone?: string
  is_friend: number
  contact_type: string
  unread_count: number
  last_message?: string
  last_message_time?: number
  /** 1 = last message was sent by us */
  is_replied?: number
}

interface SeenEntry {
  msgId: string
  seenUids: string[]
  isGroup: boolean
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface ChatStore {
  contacts: Record<string, ContactItem[]>
  messages: Record<string, MessageItem[]>
  activeThreadId: string | null
  activeThreadType: number
  replyTo: MessageItem | null
  drafts: Record<string, string>
  draftTimestamps: Record<string, number>
  typingUsers: Record<string, number>
  seenInfo: Record<string, SeenEntry>
  perAccountThread: Record<string, { threadId: string; threadType: number } | null>

  setContacts: (zaloId: string, contacts: ContactItem[]) => void
  setMessages: (zaloId: string, threadId: string, messages: MessageItem[]) => void
  addMessage: (zaloId: string, threadId: string, message: MessageItem) => void
  replaceTempMessage: (zaloId: string, threadId: string, tempContent: string, realMsg: Partial<MessageItem>) => void
  prependMessages: (zaloId: string, threadId: string, messages: MessageItem[]) => void
  updateContact: (zaloId: string, contact: Partial<ContactItem> & { contact_id: string }) => void
  setActiveThread: (threadId: string | null, type?: number) => void
  incrementUnread: (zaloId: string, contactId: string) => void
  clearUnread: (zaloId: string, contactId: string) => void
  markReplied: (zaloId: string, contactId: string) => void
  syncRepliedState: (zaloId: string, contactId: string, ownZaloId: string) => void
  setReplyTo: (msg: MessageItem | null) => void
  setDraft: (zaloId: string, threadId: string, text: string) => void
  clearDraft: (zaloId: string, threadId: string) => void
  loadDrafts: (zaloId: string) => Promise<void>
  removeMessage: (zaloId: string, threadId: string, msgId: string) => void
  recallMessage: (zaloId: string, msgId: string, threadId?: string) => void
  updateMessageReaction: (zaloId: string, threadId: string, msgId: string, userId: string, icon: string) => void
  updateLocalPaths: (zaloId: string, threadId: string, msgId: string, localPaths: Record<string, string>) => void
  updateMessageLocalPath: (zaloId: string, threadId: string, msgId: string, localPaths: Record<string, string>) => void
  removeContact: (zaloId: string, contactId: string) => void
  setTyping: (zaloId: string, threadId: string, userId: string) => void
  clearTypingForThread: (zaloId: string, threadId: string) => void
  setSeen: (zaloId: string, threadId: string, seenUids: string[], msgId: string, isGroup: boolean) => void
  saveAccountThread: (accountId: string, threadId: string, threadType: number) => void
  resetForWorkspaceSwitch: () => void
}

// ─── localStorage helpers (SSR-safe) ─────────────────────────────────────────

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, value) } catch {}
}
function lsRemove(key: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(key) } catch {}
}
function lsKeys(): string[] {
  if (typeof window === 'undefined') return []
  try { return Object.keys(localStorage) } catch { return [] }
}

// ─── Store ────────────────────────────────────────────────────────────────────

const MAX_CACHED_THREADS = 20

export const useChatStore = create<ChatStore>((set, get) => ({
  contacts: {},
  messages: {},
  activeThreadId: null,
  activeThreadType: 0,
  replyTo: null,
  typingUsers: {},
  seenInfo: {},
  perAccountThread: {},
  drafts: {},
  draftTimestamps: {},

  // ── Account thread memory ──────────────────────────────────────────────────
  saveAccountThread: (accountId, threadId, threadType) =>
    set((s) => ({
      perAccountThread: { ...s.perAccountThread, [accountId]: { threadId, threadType } },
    })),

  resetForWorkspaceSwitch: () =>
    set({
      contacts: {},
      messages: {},
      activeThreadId: null,
      activeThreadType: 0,
      replyTo: null,
      perAccountThread: {},
      drafts: {},
      draftTimestamps: {},
      typingUsers: {},
      seenInfo: {},
    }),

  // ── Contacts ───────────────────────────────────────────────────────────────
  setContacts: (zaloId, contacts) =>
    set((s) => ({ contacts: { ...s.contacts, [zaloId]: contacts } })),

  updateContact: (zaloId, contact) =>
    set((s) => {
      const list = s.contacts[zaloId] || []
      const exists = list.some((c) => c.contact_id === contact.contact_id)
      const updated = exists
        ? list.map((c) => (c.contact_id === contact.contact_id ? { ...c, ...contact } : c))
        : [
            ...list,
            {
              owner_zalo_id: zaloId,
              display_name: contact.contact_id || '',
              avatar_url: '',
              is_friend: 0,
              contact_type: 'user',
              unread_count: 0,
              last_message: '',
              last_message_time: 0,
              ...contact,
            } as ContactItem,
          ]
      updated.sort((a, b) => (b.last_message_time || 0) - (a.last_message_time || 0))
      return { contacts: { ...s.contacts, [zaloId]: updated } }
    }),

  removeContact: (zaloId, contactId) =>
    set((s) => {
      const existing = s.contacts[zaloId] || []
      const updated = existing.filter((c) => c.contact_id !== contactId)
      const msgKey = `${zaloId}_${contactId}`
      const newMessages = { ...s.messages }
      delete newMessages[msgKey]
      return { contacts: { ...s.contacts, [zaloId]: updated }, messages: newMessages }
    }),

  // ── Messages ───────────────────────────────────────────────────────────────
  setMessages: (zaloId, threadId, messages) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      const existing = s.messages[key] || []
      // Preserve recalled state from in-memory store (DB may lag)
      const recalledMap = new Map<string, MessageItem>()
      for (const m of existing) {
        if (m.is_recalled === 1) recalledMap.set(String(m.msg_id), m)
      }
      const merged =
        recalledMap.size > 0
          ? messages.map((m) => {
              const rec = recalledMap.get(String(m.msg_id))
              if (rec)
                return {
                  ...m,
                  is_recalled: 1,
                  status: 'recalled',
                  msg_type: 'recalled',
                  content: '',
                  recalled_content: rec.recalled_content ?? m.content,
                }
              return m
            })
          : messages

      // Evict old threads when cache exceeds limit
      let newMessages = { ...s.messages, [key]: merged }
      const threadKeys = Object.keys(newMessages)
      if (threadKeys.length > MAX_CACHED_THREADS) {
        const activeKey = s.activeThreadId ? `${zaloId}_${s.activeThreadId}` : null
        const toEvict = threadKeys.filter((k) => k !== key && k !== activeKey)
        const evictCount = threadKeys.length - MAX_CACHED_THREADS
        for (let i = 0; i < evictCount && i < toEvict.length; i++) {
          delete newMessages[toEvict[i]]
        }
      }
      return { messages: newMessages }
    })
  },

  addMessage: (zaloId, threadId, message) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      const existing = s.messages[key] || []
      const dupIdx = existing.findIndex((m) => String(m.msg_id) === String(message.msg_id))
      if (dupIdx >= 0) {
        // Merge handled_by_employee if needed
        const existingMsg = existing[dupIdx]
        if (message.handled_by_employee && !existingMsg.handled_by_employee) {
          const merged = { ...existingMsg, handled_by_employee: message.handled_by_employee }
          const newMessages = [...existing]
          newMessages[dupIdx] = merged
          return { messages: { ...s.messages, [key]: newMessages } }
        }
        return s
      }
      // Remove matching optimistic temp_ message when real arrives
      const extractText = (c: string): string => {
        try {
          const p = JSON.parse(c)
          if (p?.action === 'rtf' && typeof p.title === 'string') return p.title
          if (typeof p === 'string') return p
        } catch {}
        return c
      }
      let filtered = existing
      if (message.is_sent === 1 && !message.msg_id.startsWith('temp_')) {
        const incomingText = extractText(message.content)
        filtered = existing.filter(
          (m) =>
            !(m.msg_id.startsWith('temp_') && m.is_sent === 1 && extractText(m.content) === incomingText),
        )
      }
      const updated = [...filtered, message].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      return { messages: { ...s.messages, [key]: updated } }
    })
  },

  prependMessages: (zaloId, threadId, messages) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      const existing = s.messages[key] || []
      const existingIds = new Set(existing.map((m) => m.msg_id))
      const newOnes = messages.filter((m) => !existingIds.has(m.msg_id))
      if (newOnes.length === 0) return s
      return { messages: { ...s.messages, [key]: [...newOnes, ...existing] } }
    })
  },

  replaceTempMessage: (zaloId, threadId, tempContent, realMsg) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      const existing = s.messages[key] || []
      const updated = existing.map((m) =>
        m.msg_id.startsWith('temp_') && m.content === tempContent ? { ...m, ...realMsg } : m,
      )
      return { messages: { ...s.messages, [key]: updated } }
    })
  },

  removeMessage: (zaloId, threadId, msgId) => {
    const key = `${zaloId}_${threadId}`
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] || []).filter((m) => m.msg_id !== msgId),
      },
    }))
  },

  recallMessage: (zaloId, msgId, threadId?) => {
    set((s) => {
      const updatedMessages = { ...s.messages }
      const keysToCheck = threadId
        ? [`${zaloId}_${threadId}`]
        : Object.keys(updatedMessages).filter((k) => k.startsWith(zaloId + '_'))
      const msgIdStr = String(msgId)
      for (const key of keysToCheck) {
        const list = updatedMessages[key]
        if (!list) continue
        const idx = list.findIndex(
          (m) => String(m.msg_id) === msgIdStr || String(m.cli_msg_id || '') === msgIdStr,
        )
        if (idx !== -1) {
          const updated = [...list]
          const alreadyRecalled = updated[idx].is_recalled === 1
          const originalContent = alreadyRecalled
            ? updated[idx].recalled_content ?? updated[idx].content ?? null
            : updated[idx].content || null
          updated[idx] = {
            ...updated[idx],
            msg_type: 'recalled',
            content: '',
            recalled_content: originalContent,
            status: 'recalled',
            is_recalled: 1,
          }
          updatedMessages[key] = updated
          break
        }
      }
      return { messages: updatedMessages }
    })
  },

  updateMessageReaction: (zaloId, threadId, msgId, userId, icon) => {
    const key = `${zaloId}_${threadId}`
    const msgIdStr = String(msgId)
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] || []).map((m) => {
          if (String(m.msg_id) !== msgIdStr) return m
          let current: ReactionData
          const raw = m.reactions
          let parsed: Record<string, unknown> = {}
          if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw || '{}') } catch { parsed = {} }
          } else if (raw && typeof raw === 'object') {
            parsed = raw as Record<string, unknown>
          }
          if (parsed?.emoji && typeof parsed.emoji === 'object') {
            current = parsed as unknown as ReactionData
          } else {
            current = { total: 0, lastReact: '', emoji: {} }
            for (const [uid, emo] of Object.entries(parsed as Record<string, string>)) {
              if (!emo) continue
              if (!current.emoji[emo]) current.emoji[emo] = { total: 0, users: {} }
              current.emoji[emo].total++
              current.emoji[emo].users[uid] = (current.emoji[emo].users[uid] || 0) + 1
              current.total++
              current.lastReact = emo
            }
          }
          if (!icon) {
            for (const emo of Object.keys(current.emoji)) {
              const userCount = current.emoji[emo].users[userId] || 0
              if (userCount > 0) {
                current.emoji[emo].total -= userCount
                current.total -= userCount
                delete current.emoji[emo].users[userId]
                if (current.emoji[emo].total <= 0) delete current.emoji[emo]
              }
            }
          } else {
            if (!current.emoji[icon]) {
              current.emoji[icon] = { total: 1, users: { [userId]: 1 } }
            } else {
              current.emoji[icon].total++
              current.emoji[icon].users[userId] = (current.emoji[icon].users[userId] || 0) + 1
            }
            current.total++
            current.lastReact = icon
          }
          return { ...m, reactions: { ...current } }
        }),
      },
    }))
  },

  updateMessageLocalPath: (zaloId, threadId, msgId, localPaths) => {
    const key = `${zaloId}_${threadId}`
    const msgIdStr = String(msgId)
    set((s) => {
      const msgs = s.messages[key] || []
      return {
        messages: {
          ...s.messages,
          [key]: msgs.map((m) => {
            if (String(m.msg_id) !== msgIdStr) return m
            let existing: Record<string, string> = {}
            if (typeof m.local_paths === 'string') {
              try { existing = JSON.parse(m.local_paths || '{}') } catch {}
            }
            return { ...m, local_paths: JSON.stringify({ ...existing, ...localPaths }) }
          }),
        },
      }
    })
  },

  updateLocalPaths: (zaloId, threadId, msgId, localPaths) => {
    useChatStore.getState().updateMessageLocalPath(zaloId, threadId, msgId, localPaths)
  },

  // ── Thread selection & unread ───────────────────────────────────────────────
  setActiveThread: (threadId, type = 0) =>
    set({ activeThreadId: threadId, activeThreadType: type }),

  incrementUnread: (zaloId, contactId) =>
    set((s) => {
      const list = s.contacts[zaloId] || []
      return {
        contacts: {
          ...s.contacts,
          [zaloId]: list.map((c) =>
            c.contact_id === contactId
              ? { ...c, unread_count: (c.unread_count || 0) + 1, is_replied: 0 }
              : c,
          ),
        },
      }
    }),

  clearUnread: (zaloId, contactId) =>
    set((s) => {
      const list = s.contacts[zaloId] || []
      return {
        contacts: {
          ...s.contacts,
          [zaloId]: list.map((c) =>
            c.contact_id === contactId ? { ...c, unread_count: 0 } : c,
          ),
        },
      }
    }),

  markReplied: (zaloId, contactId) =>
    set((s) => {
      const list = s.contacts[zaloId] || []
      return {
        contacts: {
          ...s.contacts,
          [zaloId]: list.map((c) =>
            c.contact_id === contactId ? { ...c, unread_count: 0, is_replied: 1 } : c,
          ),
        },
      }
    }),

  syncRepliedState: (zaloId, contactId, ownZaloId) =>
    set((s) => {
      const key = `${zaloId}_${contactId}`
      const msgs = s.messages[key] || []
      if (msgs.length === 0) return s
      const lastReal = [...msgs].reverse().find(
        (m) => !m.msg_id.startsWith('temp_') && m.msg_type !== 'system',
      )
      if (!lastReal) return s
      const isReplied = lastReal.sender_id === ownZaloId || lastReal.is_sent === 1 ? 1 : 0
      const list = s.contacts[zaloId] || []
      return {
        contacts: {
          ...s.contacts,
          [zaloId]: list.map((c) =>
            c.contact_id === contactId ? { ...c, is_replied: isReplied } : c,
          ),
        },
      }
    }),

  setReplyTo: (msg) => set({ replyTo: msg }),

  // ── Drafts (localStorage) ──────────────────────────────────────────────────
  setDraft: (zaloId, threadId, text) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      if (!text.trim()) {
        lsRemove(`draft:${zaloId}:${threadId}`)
        const { [key]: _, ...restDrafts } = s.drafts
        const { [key]: __, ...restTs } = s.draftTimestamps
        return { drafts: restDrafts, draftTimestamps: restTs }
      }
      lsSet(
        `draft:${zaloId}:${threadId}`,
        JSON.stringify({ content: text, updatedAt: Date.now() }),
      )
      return {
        drafts: { ...s.drafts, [key]: text },
        draftTimestamps: { ...s.draftTimestamps, [key]: Date.now() },
      }
    })
  },

  clearDraft: (zaloId, threadId) => {
    const key = `${zaloId}_${threadId}`
    lsRemove(`draft:${zaloId}:${threadId}`)
    set((s) => {
      const { [key]: _, ...restDrafts } = s.drafts
      const { [key]: __, ...restTs } = s.draftTimestamps
      return { drafts: restDrafts, draftTimestamps: restTs }
    })
  },

  loadDrafts: async (zaloId) => {
    const prefix = `draft:${zaloId}:`
    const newDrafts: Record<string, string> = {}
    const newTimestamps: Record<string, number> = {}
    for (const lsKey of lsKeys()) {
      if (!lsKey.startsWith(prefix)) continue
      const threadId = lsKey.slice(prefix.length)
      const raw = lsGet(lsKey)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as { content: string; updatedAt: number }
        const storeKey = `${zaloId}_${threadId}`
        newDrafts[storeKey] = parsed.content
        newTimestamps[storeKey] = parsed.updatedAt
      } catch {}
    }
    if (Object.keys(newDrafts).length === 0) return
    set((s) => ({
      drafts: { ...s.drafts, ...newDrafts },
      draftTimestamps: { ...s.draftTimestamps, ...newTimestamps },
    }))
  },

  // ── Typing & seen ──────────────────────────────────────────────────────────
  setTyping: (zaloId, threadId, userId) => {
    const key = `${zaloId}_${threadId}_${userId}`
    set((s) => ({ typingUsers: { ...s.typingUsers, [key]: Date.now() } }))
    setTimeout(() => {
      set((s) => {
        const updated = { ...s.typingUsers }
        if (updated[key] && Date.now() - updated[key] >= 9500) delete updated[key]
        return { typingUsers: updated }
      })
    }, 8000)
  },

  clearTypingForThread: (zaloId, threadId) => {
    const prefix = `${zaloId}_${threadId}_`
    set((s) => {
      const updated = { ...s.typingUsers }
      let changed = false
      for (const key of Object.keys(updated)) {
        if (key.startsWith(prefix)) { delete updated[key]; changed = true }
      }
      return changed ? { typingUsers: updated } : s
    })
  },

  setSeen: (zaloId, threadId, seenUids, msgId, isGroup) => {
    const key = `${zaloId}_${threadId}`
    set((s) => {
      const prev = s.seenInfo[key]
      const prevUids = prev?.seenUids || []
      const merged = Array.from(new Set([...prevUids, ...seenUids]))
      return {
        seenInfo: {
          ...s.seenInfo,
          [key]: { msgId: msgId || prev?.msgId || 'seen', seenUids: merged, isGroup },
        },
      }
    })
  },
}))
