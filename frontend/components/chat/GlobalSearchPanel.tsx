'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Search, X, Users, User, MessageSquare } from 'lucide-react'
import { useChatStore, type ContactItem } from '@/stores/chatStore'
import { useAccountsStore } from '@/stores/accounts.store'

interface SearchResult {
  type: 'contact' | 'message'
  accountId: string
  contact?: ContactItem
  msg?: {
    msg_id: string
    content: string
    timestamp: number
    thread_id: string
  }
}

function normalizeStr(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function matchQuery(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false
  return normalizeStr(haystack).includes(normalizeStr(needle))
}

interface Props {
  onClose: () => void
  onSelectThread: (accountId: string, threadId: string, isGroup: boolean) => void
}

export default function GlobalSearchPanel({ onClose, onSelectThread }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { contacts, messages } = useChatStore()
  const { accounts } = useAccountsStore()

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const results: SearchResult[] = React.useMemo(() => {
    const q = query.trim()
    if (q.length < 1) return []
    const out: SearchResult[] = []

    for (const acc of accounts) {
      const accContacts = contacts[acc.id] || []
      for (const c of accContacts) {
        const name = c.alias || c.display_name || c.contact_id
        if (matchQuery(name, q) || matchQuery(c.contact_id, q) || (c.phone && matchQuery(c.phone, q))) {
          out.push({ type: 'contact', accountId: acc.id, contact: c })
          if (out.length >= 30) break
        }
      }

      if (out.length >= 30) break

      // Search in-memory messages
      const msgMap = messages as Record<string, Array<{
        msg_id: string; content: string; timestamp: number; thread_id: string; owner_zalo_id: string
      }>>
      for (const [_key, msgs] of Object.entries(msgMap)) {
        for (const m of msgs) {
          if (m.owner_zalo_id !== acc.id) continue
          if (typeof m.content === 'string' && matchQuery(m.content, q)) {
            out.push({
              type: 'message',
              accountId: acc.id,
              msg: { msg_id: m.msg_id, content: m.content, timestamp: m.timestamp, thread_id: m.thread_id },
            })
            if (out.length >= 30) break
          }
        }
        if (out.length >= 30) break
      }
    }

    return out
  }, [query, contacts, messages, accounts])

  const accountMap = React.useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  return (
    <div className="fixed inset-0 z-[9000] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm kiếm hội thoại, tin nhắn..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-500 hover:text-gray-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <kbd className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">Esc</kbd>
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query.trim().length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm gap-2">
              <Search className="w-8 h-8 text-gray-700" />
              Nhập để tìm kiếm
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm gap-2">
              <MessageSquare className="w-8 h-8 text-gray-700" />
              Không tìm thấy kết quả
            </div>
          ) : (
            <>
              {/* Contact results */}
              {results.filter(r => r.type === 'contact').length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-semibold px-4 pt-3 pb-1.5">HỘI THOẠI</p>
                  {results.filter(r => r.type === 'contact').map((r, i) => {
                    const c = r.contact!
                    const isGroup = c.contact_type === 'group'
                    const name = c.alias || c.display_name || c.contact_id
                    const acc = accountMap.get(r.accountId)
                    return (
                      <button key={i} onClick={() => { onSelectThread(r.accountId, c.contact_id, isGroup); onClose() }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${isGroup ? 'bg-purple-600' : 'bg-blue-600'}`}>
                          {isGroup ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{name}</p>
                          {acc && <p className="text-xs text-gray-500 truncate">{acc.phone || acc.displayName || acc.id}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Message results */}
              {results.filter(r => r.type === 'message').length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-semibold px-4 pt-3 pb-1.5">TIN NHẮN</p>
                  {results.filter(r => r.type === 'message').map((r, i) => {
                    const m = r.msg!
                    const threadContacts = contacts[r.accountId] || []
                    const threadContact = threadContacts.find(c => c.contact_id === m.thread_id)
                    const threadName = threadContact?.alias || threadContact?.display_name || m.thread_id
                    const isGroup = threadContact?.contact_type === 'group'
                    return (
                      <button key={i} onClick={() => { onSelectThread(r.accountId, m.thread_id, isGroup ?? false); onClose() }}
                        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors text-left">
                        <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-400 truncate mb-0.5">{threadName}</p>
                          <p className="text-sm text-gray-300 line-clamp-2 leading-snug">{m.content}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
