'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAccountsStore } from '@/stores/accounts.store'
import { useAuthStore } from '@/stores/auth.store'
import { useChatStore } from '@/stores/chatStore'
import { connectSocket, getSocket, joinAccountRoom } from '@/lib/socket-client'
import { useZaloSocketEvents } from '@/hooks/useZaloSocketEvents'
import ConversationList from '@/components/chat/ConversationList'
import ChatWindow from '@/components/chat/ChatWindow'
import ConversationInfo from '@/components/chat/ConversationInfo'
import GlobalSearchPanel from '@/components/chat/GlobalSearchPanel'

export default function InboxPage() {
  const { accounts, fetchAccounts } = useAccountsStore()
  const { user } = useAuthStore()
  const { setActiveThread } = useChatStore()

  const [showInfo, setShowInfo] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // Wire socket event listeners (message:new → chatStore)
  useZaloSocketEvents(accounts.map((a) => a.id))

  useEffect(() => {
    if (user?.tenantId) fetchAccounts(user.tenantId)
  }, [user?.tenantId, fetchAccounts])

  useEffect(() => {
    connectSocket()
    const socket = getSocket()
    const rejoin = () => accounts.forEach((a) => joinAccountRoom(a.id))
    rejoin()
    socket.on('connect', rejoin)
    return () => { socket.off('connect', rejoin) }
  }, [accounts])

  // Ctrl+K → global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(s => !s)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSelectThread = useCallback((accountId: string, threadId: string, isGroup: boolean) => {
    setActiveThread(threadId, isGroup ? 1 : 0)
  }, [setActiveThread])

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Left: Conversation list (320px) */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
        <ConversationList />
      </div>

      {/* Center: Chat window (flex-1) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ChatWindow onToggleInfo={() => setShowInfo(s => !s)} onOpenSearch={() => setShowSearch(true)} />
      </div>

      {/* Right: Conversation info panel (conditional) */}
      {showInfo && (
        <ConversationInfo onClose={() => setShowInfo(false)} />
      )}

      {/* Global search overlay */}
      {showSearch && (
        <GlobalSearchPanel
          onClose={() => setShowSearch(false)}
          onSelectThread={(accountId, threadId, isGroup) => {
            handleSelectThread(accountId, threadId, isGroup)
            setShowSearch(false)
          }}
        />
      )}
    </div>
  )
}
