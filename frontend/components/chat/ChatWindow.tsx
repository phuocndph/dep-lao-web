'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { CheckCheck, MessageSquare, Send, Users } from 'lucide-react'
import { useAccountsStore } from '@/stores/accounts.store'
import { useChatStore, type MessageItem } from '@/stores/chatStore'
import apiClient from '@/lib/api-client'

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
  if (isSameDay(date, today)) return 'Hom nay'
  if (isSameDay(date, yesterday)) return 'Hom qua'
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function getInitial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase()
}

export default function ChatWindow() {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentMessages.length, activeThreadId])

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
    setSending(true)
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
        <p className="text-sm font-medium">Chon mot hoi thoai de bat dau</p>
        <p className="text-xs">Tin nhan moi se xuat hien tu dong qua real-time</p>
      </div>
    )
  }

  const name = active.contact.alias || active.contact.display_name || active.contact.contact_id
  const isGroup = active.contact.contact_type === 'group' || activeThreadType === 1

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-50">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${isGroup ? 'bg-purple-500' : 'bg-blue-500'}`}>
          {isGroup ? <Users className="h-4 w-4" /> : getInitial(name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          <p className="truncate text-xs text-gray-400">
            {activeThreadId}
            {active.account.phone ? ` · Qua ${active.account.phone}` : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Chua co tin nhan nao
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
                        }`}
                        >
                          {message.content}
                        </div>
                        <div className="flex items-center gap-1 px-1">
                          <span className="text-[10px] text-gray-400">{formatTime(message.timestamp || Date.now())}</span>
                          {outbound && message.status === 'sending' && <span className="text-[10px] text-gray-400">Dang gui...</span>}
                          {outbound && message.status === 'sent' && <CheckCheck className="h-3 w-3 text-blue-400" />}
                          {outbound && message.status === 'error' && <span className="text-[10px] text-red-500">Gui that bai</span>}
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

      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            rows={1}
            placeholder="Nhan tin... (Enter de gui, Shift+Enter xuong dong)"
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
