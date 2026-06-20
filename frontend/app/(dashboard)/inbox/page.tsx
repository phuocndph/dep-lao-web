'use client'

import { useEffect } from 'react'
import { useAccountsStore } from '@/stores/accounts.store'
import { useAuthStore } from '@/stores/auth.store'
import { connectSocket, getSocket, joinAccountRoom } from '@/lib/socket-client'
import { useZaloSocketEvents } from '@/hooks/useZaloSocketEvents'
import ConversationList from '@/components/chat/ConversationList'
import ChatWindow from '@/components/chat/ChatWindow'

export default function InboxPage() {
  const { accounts, fetchAccounts } = useAccountsStore()
  const { user } = useAuthStore()

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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Conversation list (320px) */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
        <ConversationList />
      </div>

      {/* Right: Chat window (flex-1) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ChatWindow />
      </div>
    </div>
  )
}
