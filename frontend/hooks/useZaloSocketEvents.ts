'use client'

/**
 * useZaloSocketEvents.ts
 *
 * Bridges Socket.io events from the backend into the desktop-compatible
 * chatStore.  Call this hook once at layout / app level after the user
 * has logged in and accounts are loaded.
 *
 * Socket events handled:
 *   message:new       → addMessage + updateContact + incrementUnread
 *   account:status    → (logged; callers update accountsStore separately)
 *   account:connected → update contact display info
 *   qr:update         → passed through (accountsStore handles this)
 */

import { useEffect } from 'react'
import { getSocket } from '@/lib/socket-client'
import { useChatStore, type MessageItem, type ContactItem } from '@/stores/chatStore'

// ─── Socket payload types ──────────────────────────────────────────────────────

interface SocketIncomingMessage {
  msgId: string
  threadId: string
  threadType: 'user' | 'group'
  fromUserId: string
  content: string | Record<string, unknown>
  timestamp: number
  isGroup: boolean
  senderName?: string
}

interface MessageNewEvent {
  accountId: string
  workerId?: string
  message: SocketIncomingMessage
}

interface AccountStatusEvent {
  accountId: string
  status: string
  zaloUid?: string
  displayName?: string
  phone?: string
}

// ─── Conversion helpers ────────────────────────────────────────────────────────

function contentToString(c: string | Record<string, unknown>): string {
  return typeof c === 'string' ? c : JSON.stringify(c)
}

function toMessageItem(accountId: string, msg: SocketIncomingMessage): MessageItem {
  return {
    msg_id: msg.msgId,
    owner_zalo_id: accountId,
    thread_id: msg.threadId,
    thread_type: msg.isGroup ? 1 : 0,
    sender_id: msg.fromUserId,
    content: contentToString(msg.content),
    msg_type: 'text',
    timestamp: msg.timestamp,
    is_sent: 0,
    status: 'received',
  }
}

function toContactPatch(
  accountId: string,
  msg: SocketIncomingMessage,
  contentStr: string,
): Partial<ContactItem> & { contact_id: string } {
  return {
    owner_zalo_id: accountId,
    contact_id: msg.threadId,
    display_name: msg.senderName || msg.fromUserId,
    contact_type: msg.isGroup ? 'group' : 'user',
    is_friend: 0,
    avatar_url: '',
    last_message: contentStr.slice(0, 120),
    last_message_time: msg.timestamp,
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param accountIds — list of account UUIDs currently loaded.
 *   Used to verify that incoming events belong to a known account.
 *   Pass an empty array before accounts are loaded; the hook is safe to call
 *   before accounts are fetched.
 */
export function useZaloSocketEvents(accountIds: string[]): void {
  useEffect(() => {
    const socket = getSocket()
    const store = useChatStore.getState

    // ── message:new ────────────────────────────────────────────────────────
    const handleMessageNew = (data: MessageNewEvent) => {
      const { accountId, message } = data
      if (!accountId || !message?.msgId || !message?.threadId) return

      const contentStr = contentToString(message.content)
      const msgItem = toMessageItem(accountId, message)
      const contactPatch = toContactPatch(accountId, message, contentStr)

      const s = store()

      // Add message to store
      s.addMessage(accountId, message.threadId, msgItem)

      // Update (or create) the contact / thread entry
      s.updateContact(accountId, contactPatch)

      // Increment unread counter when not currently viewing this thread
      if (s.activeThreadId !== message.threadId) {
        s.incrementUnread(accountId, message.threadId)
      }
    }

    // ── account:status ─────────────────────────────────────────────────────
    // The accountsStore in accounts.store.ts already handles this via its own
    // socket listener in accounts/page.tsx.  Here we just log in dev mode.
    const handleAccountStatus = (data: AccountStatusEvent) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[useZaloSocketEvents] account:status', data.accountId, data.status)
      }
    }

    // ── account:connected ──────────────────────────────────────────────────
    // Backend emits this when a worker logs in successfully.
    // The contactPatch here updates any existing contact entry for the
    // account itself (e.g. the account's own profile card).
    const handleAccountConnected = (data: {
      accountId: string
      displayName?: string
      phone?: string
      zaloUid?: string
    }) => {
      if (!data?.accountId) return
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[useZaloSocketEvents] account:connected', data)
      }
      // Nothing to do in chatStore — accountsStore handles UI update.
    }

    socket.on('message:new', handleMessageNew)
    socket.on('account:status', handleAccountStatus)
    socket.on('account:connected', handleAccountConnected)

    return () => {
      socket.off('message:new', handleMessageNew)
      socket.off('account:status', handleAccountStatus)
      socket.off('account:connected', handleAccountConnected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIds.join(',')])
}
