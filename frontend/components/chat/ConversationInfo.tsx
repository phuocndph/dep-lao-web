'use client'

import React from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useAccountsStore } from '@/stores/accounts.store'
import { Users, Phone, User } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function ConversationInfo({ onClose }: Props) {
  const { activeThreadId, activeThreadType, contacts } = useChatStore()
  const { accounts } = useAccountsStore()

  // Find which account owns this thread
  const allContacts = Object.values(contacts).flat()
  const contact = allContacts.find(c => c.contact_id === activeThreadId)
  const ownerAccount = contact
    ? accounts.find(a => a.id === contact.owner_zalo_id)
    : undefined

  const isGroup = activeThreadType === 1 || contact?.contact_type === 'group'
  const displayName = contact?.alias || contact?.display_name || activeThreadId || '?'
  const avatarUrl = contact?.avatar_url || ''

  if (!activeThreadId) return null

  return (
    <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">Thông tin</span>
        <button onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-2 pt-6 pb-4 px-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0 ${isGroup ? 'bg-purple-500' : 'bg-blue-500'}`}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
          ) : isGroup ? (
            <Users className="w-8 h-8" />
          ) : (
            displayName.charAt(0).toUpperCase()
          )}
        </div>
        <p className="text-gray-900 font-semibold text-center leading-snug">{displayName}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full ${isGroup ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
          {isGroup ? 'Nhóm' : 'Cá nhân'}
        </span>
      </div>

      {/* Details */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-1">
          {contact?.phone && (
            <InfoRow icon={<Phone className="w-4 h-4" />} label="Số điện thoại" value={contact.phone} />
          )}
          <InfoRow icon={<User className="w-4 h-4" />} label="ID" value={activeThreadId} mono />
          {ownerAccount && (
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              label="Tài khoản Zalo"
              value={ownerAccount.phone || ownerAccount.displayName || ownerAccount.id}
            />
          )}
          {contact && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Trạng thái</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${contact.is_friend ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-600">{contact.is_friend ? 'Bạn bè' : 'Chưa kết bạn'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 leading-tight">{label}</p>
        <p className={`text-sm text-gray-700 leading-snug truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
      </div>
    </div>
  )
}
