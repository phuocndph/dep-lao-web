'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { MessageSquare, RefreshCw, Search, Users } from 'lucide-react'
import { useAccountsStore } from '@/stores/accounts.store'
import { useChatStore, type ContactItem } from '@/stores/chatStore'
import apiClient from '@/lib/api-client'

interface ThreadRow {
  accountId: string
  contact: ContactItem
}

interface ApiThread {
  threadId: string
  threadType: 'USER' | 'GROUP' | 'user' | 'group'
  accountId: string
  unreadCount: number
  lastMessage?: {
    content?: string | null
    sentAt?: string
    direction?: string
  }
}

function formatTime(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function getInitial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase()
}

function threadTypeToNumber(type: ApiThread['threadType']): number {
  return String(type).toLowerCase() === 'group' ? 1 : 0
}

function apiThreadToContact(thread: ApiThread): ContactItem {
  const sentAt = thread.lastMessage?.sentAt ? new Date(thread.lastMessage.sentAt).getTime() : 0
  return {
    owner_zalo_id: thread.accountId,
    contact_id: thread.threadId,
    display_name: thread.threadId,
    avatar_url: '',
    is_friend: 0,
    contact_type: threadTypeToNumber(thread.threadType) === 1 ? 'group' : 'user',
    unread_count: thread.unreadCount || 0,
    last_message: thread.lastMessage?.content || '',
    last_message_time: Number.isFinite(sentAt) ? sentAt : 0,
    is_replied: thread.lastMessage?.direction === 'OUTBOUND' ? 1 : 0,
  }
}

export default function ConversationList() {
  const [search, setSearch] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadError, setLoadError] = useState('')
  const hasFetched = useRef(false)
  const { accounts } = useAccountsStore()
  const { contacts, activeThreadId, setActiveThread, clearUnread, setMessages, updateContact } = useChatStore()

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const rows = useMemo<ThreadRow[]>(() => {
    const q = search.trim().toLowerCase()
    const all: ThreadRow[] = []
    for (const account of accounts) {
      for (const contact of contacts[account.id] || []) {
        const name = contact.alias || contact.display_name || contact.contact_id
        if (
          q &&
          !name.toLowerCase().includes(q) &&
          !contact.contact_id.toLowerCase().includes(q) &&
          !(contact.phone || '').toLowerCase().includes(q)
        ) {
          continue
        }
        all.push({ accountId: account.id, contact })
      }
    }
    return all.sort(
      (a, b) => (b.contact.last_message_time || 0) - (a.contact.last_message_time || 0),
    )
  }, [accounts, contacts, search])

  useEffect(() => {
    if (hasFetched.current) return
    hasFetched.current = true
    void loadThreadsFromServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadThreadsFromServer() {
    setLoadingThreads(true)
    setLoadError('')
    try {
      const threads = await apiClient.get<ApiThread[]>('/api/messages/threads')
      for (const thread of threads) {
        updateContact(thread.accountId, apiThreadToContact(thread))
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Khong tai duoc danh sach hoi thoai')
    } finally {
      setLoadingThreads(false)
    }
  }

  async function selectThread(row: ThreadRow) {
    const isGroup = row.contact.contact_type === 'group'
    setActiveThread(row.contact.contact_id, isGroup ? 1 : 0)
    clearUnread(row.accountId, row.contact.contact_id)
    try {
      await apiClient.patch(`/api/messages/${row.contact.contact_id}/read`, {})
      const messages = await apiClient.get<unknown[]>(
        `/api/messages/${row.contact.contact_id}?limit=50`,
      )
      setMessages(row.accountId, row.contact.contact_id, messages.map((msg) => {
        const m = msg as Record<string, unknown>
        const sentAt = typeof m.sentAt === 'string' ? new Date(m.sentAt).getTime() : Date.now()
        return {
          msg_id: String(m.zaloMsgId || m.id || `${row.contact.contact_id}_${sentAt}`),
          owner_zalo_id: row.accountId,
          thread_id: row.contact.contact_id,
          thread_type: isGroup ? 1 : 0,
          sender_id: String(m.direction === 'OUTBOUND' ? 'me' : m.contactId || row.contact.contact_id),
          content: String(m.content || ''),
          msg_type: String(m.contentType || 'text').toLowerCase(),
          timestamp: sentAt,
          is_sent: m.direction === 'OUTBOUND' ? 1 : 0,
          status: 'sent',
        }
      }))
    } catch {
      // Realtime messages may already be in memory; keep selection usable even if history API fails.
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-100 p-3">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tim kiem..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <button
            onClick={loadThreadsFromServer}
            disabled={loadingThreads}
            title="Tai lai hoi thoai"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingThreads ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {loadError && <p className="mt-2 text-xs text-red-500">{loadError}</p>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400">
            <MessageSquare className="h-8 w-8" />
            <p className="text-xs">Chua co hoi thoai nao</p>
          </div>
        ) : (
          rows.map((row) => {
            const name = row.contact.alias || row.contact.display_name || row.contact.contact_id
            const isGroup = row.contact.contact_type === 'group'
            const selected = activeThreadId === row.contact.contact_id
            const account = accountMap.get(row.accountId)
            return (
              <button
                key={`${row.accountId}_${row.contact.contact_id}`}
                onClick={() => selectThread(row)}
                className={`flex w-full items-start gap-3 border-b border-gray-50 px-3 py-3 text-left transition hover:bg-gray-50 ${
                  selected ? 'bg-blue-50 hover:bg-blue-50' : ''
                }`}
              >
                <div className="relative flex-shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${isGroup ? 'bg-purple-500' : 'bg-blue-500'}`}>
                    {isGroup ? <Users className="h-5 w-5" /> : getInitial(name)}
                  </div>
                  <span className="absolute -bottom-1 -right-1 max-w-12 truncate rounded-full bg-gray-700 px-1 text-[9px] leading-4 text-white">
                    {account?.phone || account?.displayName || '?'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${row.contact.unread_count > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {name}
                    </span>
                    <span className="flex-shrink-0 text-[11px] text-gray-400">
                      {formatTime(row.contact.last_message_time)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-gray-500">{row.contact.last_message || ''}</p>
                    {row.contact.unread_count > 0 && (
                      <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {row.contact.unread_count > 99 ? '99+' : row.contact.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
