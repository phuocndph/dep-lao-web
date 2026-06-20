'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { CheckCheck, MessageSquare, Send, Users, Zap } from 'lucide-react'
import { useAccountsStore } from '@/stores/accounts.store'
import { useChatStore, type MessageItem } from '@/stores/chatStore'
import apiClient from '@/lib/api-client'

interface QuickMsg {
  id: string
  keyword: string
  title: string
  content: string | null
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDateGroup(ts: number): string {
  const date = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(date, today)) return 'Hôm nay'
  if (isSameDay(date, yesterday)) return 'Hôm qua'
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function getInitial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase()
}

interface ChatWindowProps {
  onToggleInfo?: () => void
  onOpenSearch?: () => void
}

export default function ChatWindow({ onToggleInfo, onOpenSearch }: ChatWindowProps = {}) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [quickMsgs, setQuickMsgs] = useState<QuickMsg[]>([])
  const [showQuick, setShowQuick] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevThreadRef = useRef<string | null>(null)

  const { accounts } = useAccountsStore()
  const {
    contacts,
    messages,
    activeThreadId,
    activeThreadType,
    addMessage,
    replaceTempMessage,
    markReplied,
  } = useChatStore()

  const active = useMemo(() => {
    if (!activeThreadId) return null
    for (const account of accounts) {
      const contact = (contacts[account.id] || []).find((item) => item.contact_id === activeThreadId)
      if (contact) return { account, contact }
    }
    return null
  }, [accounts, contacts, activeThreadId])

  const currentMessages = useMemo<MessageItem[]>(() => {
    if (!active || !activeThreadId) return []
    return messages[`${active.account.id}_${activeThreadId}`] || []
  }, [active, activeThreadId, messages])

  const groups = useMemo(() => {
    const result: { date: string; messages: MessageItem[] }[] = []
    let last = ''
    for (const message of currentMessages) {
      const label = formatDateGroup(message.timestamp || Date.now())
      if (label !== last) {
        last = label
        result.push({ date: label, messages: [] })
      }
      result[result.length - 1].messages.push(message)
    }
    return result
  }, [currentMessages])

  // Load quick messages once
  useEffect(() => {
    apiClient.get<QuickMsg[]>('/api/quick-messages').then(setQuickMsgs).catch(() => {})
  }, [])

  // Save draft to backend (debounced)
  const saveDraft = useCallback((accountId: string, threadId: string, content: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      if (content.trim()) {
        apiClient.put('/api/drafts', { accountId, threadId, content }).catch(() => {})
      } else {
        apiClient.del(`/api/drafts?accountId=${accountId}&threadId=${threadId}`).catch(() => {})
      }
    }, 1500)
  }, [])

  // Load draft when thread changes
  useEffect(() => {
    if (!active || !activeThreadId) return
    if (prevThreadRef.current === activeThreadId) return
    prevThreadRef.current = activeThreadId

    apiClient
      .get<{ content: string } | null>(
        `/api/drafts?accountId=${active.account.id}&threadId=${activeThreadId}`,
      )
      .then((draft) => {
        setInput(draft?.content ?? '')
        setTimeout(() => textareaRef.current?.focus(), 50)
      })
      .catch(() => { setInput(''); setTimeout(() => textareaRef.current?.focus(), 50) })
  }, [active, activeThreadId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages.length, activeThreadId])

  function handleInputChange(value: string) {
    setInput(value)
    if (active) saveDraft(active.account.id, activeThreadId!, value)

    // Quick message trigger: "/"
    if (value.startsWith('/')) {
      setQuickFilter(value.slice(1).toLowerCase())
      setShowQuick(true)
    } else {
      setShowQuick(false)
    }
  }

  const filteredQuick = useMemo(() => {
    if (!quickFilter) return quickMsgs
    return quickMsgs.filter(
      (m) =>
        m.keyword.toLowerCase().includes(quickFilter) ||
        m.title.toLowerCase().includes(quickFilter),
    )
  }, [quickMsgs, quickFilter])

  function applyQuickMsg(msg: QuickMsg) {
    const content = msg.content ?? msg.title
    setInput(content)
    setShowQuick(false)
    textareaRef.current?.focus()
  }

  async function sendMessage() {
    if (!active || !activeThreadId || !input.trim() || sending) return
    const content = input.trim()
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const tempMessage: MessageItem = {
      msg_id: tempId,
      owner_zalo_id: active.account.id,
      thread_id: activeThreadId,
      thread_type: activeThreadType,
      sender_id: 'me',
      content,
      msg_type: 'text',
      timestamp: Date.now(),
      is_sent: 1,
      status: 'sending',
    }

    addMessage(active.account.id, activeThreadId, tempMessage)
    setInput('')
    setShowQuick(false)
    setSending(true)

    // Clear draft
    apiClient.del(`/api/drafts?accountId=${active.account.id}&threadId=${activeThreadId}`).catch(() => {})

    try {
      await apiClient.post(`/api/accounts/${active.account.id}/send`, {
        threadId: activeThreadId,
        threadType: activeThreadType === 1 ? 'group' : 'user',
        content,
      })
      replaceTempMessage(active.account.id, activeThreadId, content, { status: 'sent' })
      markReplied(active.account.id, activeThreadId)
    } catch {
      replaceTempMessage(active.account.id, activeThreadId, content, { status: 'error' })
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  if (!active || !activeThreadId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-50 text-gray-400">
        <MessageSquare className="h-12 w-12" />
        <p className="text-sm font-medium">Chọn một hội thoại để bắt đầu</p>
        <p className="text-xs">Tin nhắn mới sẽ xuất hiện tự động qua real-time</p>
      </div>
    )
  }

  const name = active.contact.alias || active.contact.display_name || active.contact.contact_id
  const isGroup = active.contact.contact_type === 'group' || activeThreadType === 1

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-50">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${isGroup ? 'bg-purple-500' : 'bg-blue-500'}`}>
          {isGroup ? <Users className="h-4 w-4" /> : getInitial(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          <p className="truncate text-xs text-gray-400">
            {activeThreadId}
            {active.account.phone ? ` · Qua ${active.account.phone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onOpenSearch && (
            <button onClick={onOpenSearch} title="Tìm kiếm (Ctrl+K)"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          )}
          {onToggleInfo && (
            <button onClick={onToggleInfo} title="Thông tin hội thoại"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Chưa có tin nhắn nào
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="select-none text-xs text-gray-400">{group.date}</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <div className="space-y-1">
                {group.messages.map((message) => {
                  const outbound = message.is_sent === 1
                  return (
                    <div key={message.msg_id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex max-w-[70%] flex-col gap-0.5 ${outbound ? 'items-end' : 'items-start'}`}>
                        {!outbound && message.sender_id && (
                          <span className="px-1 text-[11px] text-gray-500">{message.sender_id}</span>
                        )}
                        <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                          outbound
                            ? message.status === 'error'
                              ? 'rounded-br-sm bg-red-400 text-white'
                              : 'rounded-br-sm bg-blue-500 text-white'
                            : 'rounded-bl-sm border border-gray-100 bg-white text-gray-800 shadow-sm'
                        }`}>
                          {message.content}
                        </div>
                        <div className="flex items-center gap-1 px-1">
                          <span className="text-[10px] text-gray-400">{formatTime(message.timestamp || Date.now())}</span>
                          {outbound && message.status === 'sending' && <span className="text-[10px] text-gray-400">Đang gửi...</span>}
                          {outbound && message.status === 'sent' && <CheckCheck className="h-3 w-3 text-blue-400" />}
                          {outbound && message.status === 'error' && <span className="text-[10px] text-red-500">Gửi thất bại</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Input area */}
      <div className="relative flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        {/* Quick message picker */}
        {showQuick && filteredQuick.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-xs font-medium text-gray-500">Tin nhắn nhanh</span>
            </div>
            {filteredQuick.map((msg) => (
              <button
                key={msg.id}
                onClick={() => applyQuickMsg(msg)}
                className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="text-xs font-semibold text-blue-600">/{msg.keyword}</span>
                <span className="text-sm text-gray-700 line-clamp-1">{msg.content || msg.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setShowQuick(false); return }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            rows={1}
            placeholder="Nhắn tin... (Enter để gửi, Shift+Enter xuống dòng, / cho tin nhắn nhanh)"
            className="max-h-32 flex-1 resize-none overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue-400"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || sending}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200"
          >
            <Send className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}
