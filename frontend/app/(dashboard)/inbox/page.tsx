'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Search, Send, MessageSquare, Users, CheckCheck } from 'lucide-react'
import { useChatStore, type MessageItem } from '@/stores/chatStore'
import { useAccountsStore } from '@/stores/accounts.store'
import { useAuthStore } from '@/stores/auth.store'
import { connectSocket, getSocket, joinAccountRoom } from '@/lib/socket-client'
import { useZaloSocketEvents } from '@/hooks/useZaloSocketEvents'
import apiClient from '@/lib/api-client'

// ── Date / time helpers ───────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDateGroup(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(d, today)) return 'Hôm nay'
  if (isSameDay(d, yesterday)) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function getInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase()
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActiveThread {
  accountId: string
  threadId: string
  threadType: number // 0 = user, 1 = group
  displayName: string
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { contacts, messages, activeThreadId, setActiveThread, clearUnread, addMessage, replaceTempMessage } =
    useChatStore()
  const { accounts, fetchAccounts } = useAccountsStore()
  const { user } = useAuthStore()

  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [activeThread, setActiveThreadState] = useState<ActiveThread | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Bootstrap ────────────────────────────────────────────────────────────

  // Wire socket event listeners (message:new → chatStore)
  useZaloSocketEvents(accounts.map((a) => a.id))

  // Fetch accounts on login
  useEffect(() => {
    if (user?.tenantId) fetchAccounts(user.tenantId)
  }, [user?.tenantId, fetchAccounts])

  // Connect socket + join all account rooms
  useEffect(() => {
    connectSocket()
    const socket = getSocket()
    const rejoin = () => accounts.forEach((a) => joinAccountRoom(a.id))
    rejoin()
    socket.on('connect', rejoin)
    return () => { socket.off('connect', rejoin) }
  }, [accounts])

  // ── Derived thread list ───────────────────────────────────────────────────

  // Merge contacts from all accounts into one sorted list
  const threadList = useMemo(() => {
    const q = search.trim().toLowerCase()
    type ThreadEntry = {
      accountId: string
      contact: (typeof contacts)[string][number]
    }
    const entries: ThreadEntry[] = []
    for (const accountId of accounts.map((a) => a.id)) {
      for (const c of contacts[accountId] || []) {
        entries.push({ accountId, contact: c })
      }
    }
    return entries
      .filter(({ contact: c }) =>
        !q ||
        (c.display_name || '').toLowerCase().includes(q) ||
        c.contact_id.includes(q) ||
        (c.alias || '').toLowerCase().includes(q),
      )
      .sort((a, b) => (b.contact.last_message_time || 0) - (a.contact.last_message_time || 0))
  }, [contacts, accounts, search])

  // ── Selected thread messages ───────────────────────────────────────────────

  const currentMessages: MessageItem[] = useMemo(() => {
    if (!activeThread) return []
    const key = `${activeThread.accountId}_${activeThread.threadId}`
    return messages[key] || []
  }, [messages, activeThread])

  // Day-grouped messages for conversation view
  const messageGroups = useMemo(() => {
    if (!currentMessages.length) return []
    const groups: { date: string; messages: MessageItem[] }[] = []
    let lastDate = ''
    for (const msg of currentMessages) {
      const label = formatDateGroup(msg.timestamp)
      if (label !== lastDate) { lastDate = label; groups.push({ date: label, messages: [] }) }
      groups[groups.length - 1].messages.push(msg)
    }
    return groups
  }, [currentMessages])

  // Account lookup map for badges
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages.length])

  // ── Thread selection ──────────────────────────────────────────────────────

  const handleSelectThread = useCallback(
    (accountId: string, threadId: string, threadType: number, displayName: string) => {
      setActiveThread(threadId, threadType)
      clearUnread(accountId, threadId)
      setActiveThreadState({ accountId, threadId, threadType, displayName })
    },
    [setActiveThread, clearUnread],
  )

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeThread || isSending) return
    const content = input.trim()
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`

    const tempMsg: MessageItem = {
      msg_id: tempId,
      owner_zalo_id: activeThread.accountId,
      thread_id: activeThread.threadId,
      thread_type: activeThread.threadType,
      sender_id: 'me',
      content,
      msg_type: 'text',
      timestamp: Date.now(),
      is_sent: 1,
      status: 'sending',
    }
    addMessage(activeThread.accountId, activeThread.threadId, tempMsg)
    setInput('')
    setIsSending(true)

    try {
      await apiClient.post(`/api/accounts/${activeThread.accountId}/send`, {
        threadId: activeThread.threadId,
        threadType: activeThread.threadType,
        content,
      })
      replaceTempMessage(activeThread.accountId, activeThread.threadId, content, {
        status: 'sent',
      })
    } catch {
      replaceTempMessage(activeThread.accountId, activeThread.threadId, content, {
        status: 'error',
      })
    } finally {
      setIsSending(false)
      textareaRef.current?.focus()
    }
  }, [input, activeThread, isSending, addMessage, replaceTempMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    },
    [handleSend],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: Thread list ──────────────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Search */}
        <div className="px-3 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm kiếm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-gray-50"
            />
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {threadList.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
              <MessageSquare className="h-8 w-8" />
              <p className="text-xs">Chưa có tin nhắn nào</p>
            </div>
          )}

          {threadList.map(({ accountId, contact: c }) => {
            const isGroup = c.contact_type === 'group'
            const isSelected =
              activeThread?.accountId === accountId && activeThread.threadId === c.contact_id
            const account = accountMap.get(accountId)
            const displayName = c.alias || c.display_name || c.contact_id

            return (
              <button
                key={`${accountId}_${c.contact_id}`}
                onClick={() =>
                  handleSelectThread(accountId, c.contact_id, isGroup ? 1 : 0, displayName)
                }
                className={`w-full flex items-start gap-3 px-3 py-3 border-b border-gray-50 text-left transition-colors hover:bg-gray-50 ${
                  isSelected ? 'bg-blue-50 hover:bg-blue-50' : ''
                }`}
              >
                {/* Avatar + account badge */}
                <div className="relative flex-shrink-0">
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold text-white ${
                      isGroup ? 'bg-purple-500' : 'bg-blue-500'
                    }`}
                  >
                    {isGroup ? (
                      <Users className="h-5 w-5" />
                    ) : (
                      getInitial(displayName)
                    )}
                  </div>
                  {account && (
                    <div className="absolute -bottom-1 -right-1 bg-gray-600 text-white text-[9px] rounded-full px-1 leading-4 max-w-[44px] truncate">
                      {account.phone ?? account.displayName?.slice(0, 6) ?? '?'}
                    </div>
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-sm truncate ${
                        c.unread_count > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'
                      }`}
                    >
                      {displayName}
                    </span>
                    {c.last_message_time ? (
                      <span className="text-[11px] text-gray-400 flex-shrink-0">
                        {formatTime(c.last_message_time)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-xs text-gray-500 truncate">
                      {c.is_replied === 1 ? (
                        <span className="inline-flex items-center gap-0.5 text-gray-400">
                          <CheckCheck className="h-3 w-3" />
                          {c.last_message}
                        </span>
                      ) : (
                        c.last_message || ''
                      )}
                    </p>
                    {c.unread_count > 0 && (
                      <span className="flex-shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                        {c.unread_count > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right: Conversation ────────────────────────────────────────────── */}
      {activeThread ? (
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
          {/* Header */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <div
              className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${
                activeThread.threadType === 1 ? 'bg-purple-500' : 'bg-blue-500'
              }`}
            >
              {activeThread.threadType === 1 ? (
                <Users className="h-4 w-4" />
              ) : (
                getInitial(activeThread.displayName)
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{activeThread.displayName}</p>
              <p className="text-xs text-gray-400 truncate">
                {activeThread.threadId}
                {accountMap.get(activeThread.accountId)?.phone &&
                  ` · Qua ${accountMap.get(activeThread.accountId)!.phone}`}
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messageGroups.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Chưa có tin nhắn nào
              </div>
            )}

            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 select-none">{group.date}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Bubbles */}
                <div className="space-y-1">
                  {group.messages.map((msg) => {
                    const isOutbound = msg.is_sent === 1
                    return (
                      <div
                        key={msg.msg_id}
                        className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`flex flex-col gap-0.5 max-w-[70%] ${
                            isOutbound ? 'items-end' : 'items-start'
                          }`}
                        >
                          {!isOutbound && msg.sender_id && (
                            <span className="text-[11px] text-gray-500 px-1">
                              {msg.sender_id}
                            </span>
                          )}
                          <div
                            className={`px-3 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap ${
                              msg.is_recalled === 1
                                ? 'bg-gray-100 text-gray-400 italic border border-gray-200 rounded-lg'
                                : isOutbound
                                ? msg.status === 'error'
                                  ? 'bg-red-400 text-white rounded-br-sm'
                                  : 'bg-blue-500 text-white rounded-br-sm'
                                : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm'
                            }`}
                          >
                            {msg.is_recalled === 1
                              ? 'Tin nhắn đã được thu hồi'
                              : msg.content}
                          </div>
                          <div className="flex items-center gap-1 px-1">
                            <span className="text-[10px] text-gray-400">
                              {formatTime(msg.timestamp)}
                            </span>
                            {isOutbound && msg.status === 'sending' && (
                              <span className="text-[10px] text-gray-400">Đang gửi...</span>
                            )}
                            {isOutbound && msg.status === 'sent' && (
                              <CheckCheck className="h-3 w-3 text-blue-400" />
                            )}
                            {isOutbound && msg.status === 'error' && (
                              <span className="text-[10px] text-red-500">Gửi thất bại</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nhắn tin... (Enter để gửi, Shift+Enter xuống dòng)"
                rows={1}
                className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-400 max-h-32 overflow-y-auto bg-gray-50 leading-relaxed"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="h-9 w-9 flex-shrink-0 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                <Send className="h-4 w-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 bg-gray-50">
          <MessageSquare className="h-12 w-12" />
          <p className="text-sm font-medium">Chọn một cuộc trò chuyện để bắt đầu</p>
          <p className="text-xs">Tin nhắn mới sẽ xuất hiện tự động qua real-time</p>
        </div>
      )}
    </div>
  )
}
