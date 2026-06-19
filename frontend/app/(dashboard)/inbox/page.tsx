'use client'

import { useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import Header from '@/components/layout/header'
import { useChatStore } from '@/stores/chat.store'
import { getSocket, connectSocket } from '@/lib/socket-client'

export default function InboxPage() {
  const { messages, addMessage } = useChatStore()

  useEffect(() => {
    connectSocket()
    const socket = getSocket()
    socket.on('message:new', addMessage)
    return () => {
      socket.off('message:new', addMessage)
    }
  }, [addMessage])

  return (
    <div className="flex flex-col h-full">
      <Header title="Inbox" />
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <MessageSquare className="h-12 w-12" />
            <p className="text-sm">Chưa có tin nhắn nào</p>
            <p className="text-xs">Tin nhắn từ tất cả tài khoản Zalo sẽ hiện ở đây</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-2xl">
            {messages.map((msg) => (
              <div key={msg.id} className="rounded-lg bg-white p-4 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-blue-600">
                    Account: {msg.accountId.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(msg.timestamp).toLocaleTimeString('vi-VN')}
                  </span>
                </div>
                <p className="text-sm text-gray-800">{msg.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
