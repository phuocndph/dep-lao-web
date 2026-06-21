/**
 * ipc.ts — Web adapter for the Electron IPC interface.
 *
 * Provides the same `ipc` object shape as the Deplao desktop app so that
 * UI logic can be ported with minimal changes.  The Electron IPC calls are
 * replaced with:
 *   - REST API calls (apiClient)
 *   - Socket.io events (socket-client)
 *   - In-memory chatStore reads
 *   - localStorage for drafts
 */

import apiClient from './api-client'

// ─── localStorage helpers (SSR-safe) ─────────────────────────────────────────

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, value) } catch {}
}
function lsRemove(key: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(key) } catch {}
}
function lsKeys(): string[] {
  if (typeof window === 'undefined') return []
  try { return Object.keys(localStorage) } catch { return [] }
}

// ─── QR session map: accountId (DB UUID) → tempId (local string) ─────────────
// Populated by loginQR so the socket bridge can correlate qr:update events.
const _qrTempIdMap = new Map<string, string>()

export function getQrTempId(accountId: string): string | undefined {
  return _qrTempIdMap.get(accountId)
}

export function deleteQrMapping(accountId: string): void {
  _qrTempIdMap.delete(accountId)
}

// ─── stub factory ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notImpl(name: string): (...args: any[]) => Promise<{ success: false; error: string }> {
  return async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[ipc] "${name}" is not implemented in the web version`)
    }
    return { success: false as const, error: 'not implemented' }
  }
}

// ─── Event emitter (ipc.on / ipc.removeAllListeners) ─────────────────────────
// Desktop components use ipc.on('event:message', cb).  In the web version we
// expose the same API.  Socket → IPC channel bridging is handled by the
// useZaloSocketEvents hook instead of here, to avoid SSR + circular-dep issues.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void
const _listeners = new Map<string, Set<AnyFn>>()

function onEvent(channel: string, cb: AnyFn): () => void {
  if (!_listeners.has(channel)) _listeners.set(channel, new Set())
  _listeners.get(channel)!.add(cb)
  return () => _listeners.get(channel)?.delete(cb)
}

export function emitIpcEvent(channel: string, ...args: unknown[]): void {
  _listeners.get(channel)?.forEach((cb) => cb(...args))
}

// ─── ipc.login ────────────────────────────────────────────────────────────────

const login = {
  getAccounts: async () => {
    try {
      // Backend returns AccountListItem[]: { id, phone, displayName, status, connectedAt, unreadCount }
      // Desktop accountStore expects AccountInfo: { zalo_id, full_name, imei, cookies, ... }
      const data = await apiClient.get<Array<{
        id: string
        phone: string | null
        displayName: string | null
        status: string
        connectedAt?: number
        unreadCount: number
      }>>('/api/accounts')
      const list = Array.isArray(data) ? data : []
      const accounts = list.map((acc) => ({
        zalo_id: acc.id,
        full_name: acc.displayName || acc.phone || acc.id,
        display_name: acc.displayName || acc.phone || acc.id,
        avatar_url: '',
        phone: acc.phone || '',
        is_business: 0,
        imei: '',
        user_agent: '',
        cookies: '',
        is_active: 1,
        created_at: '',
        isOnline: acc.status === 'connected',
        isConnected: acc.status === 'connected',
        listenerActive: acc.status === 'connected',
        channel: 'zalo' as const,
      }))
      return { success: true, accounts }
    } catch (err) {
      return { success: false, accounts: [], error: String(err) }
    }
  },
  connectAccount: notImpl('login.connectAccount'),
  disconnectAccount: async (accountId: string) => {
    try {
      await apiClient.post(`/api/accounts/${accountId}/disconnect`, {})
      return { success: true }
    } catch {
      return { success: false }
    }
  },
  disconnectAll: notImpl('login.disconnectAll'),
  removeAccount: async (accountId: string) => {
    try {
      await apiClient.del(`/api/accounts/${accountId}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  loginQR: async (tempId: string, _proxyId?: number | null) => {
    try {
      const account = await apiClient.post<{ id: string }>('/api/accounts', {})
      const accountId = account.id
      _qrTempIdMap.set(accountId, tempId)
      // Join socket room so the gateway sends qr:update to this client
      const { joinAccountRoom } = await import('./socket-client')
      joinAccountRoom(accountId)
      return { success: true, accountId }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  loginQRAbort: async (tempId: string) => {
    for (const [accountId, tid] of _qrTempIdMap.entries()) {
      if (tid === tempId) {
        _qrTempIdMap.delete(accountId)
        try { await apiClient.del(`/api/accounts/${accountId}`) } catch { /* best-effort */ }
        break
      }
    }
    return { success: true }
  },
  loginCookies: notImpl('login.loginCookies'),
  loginAuth: notImpl('login.loginAuth'),
  checkHealth: notImpl('login.checkHealth'),
  requestOldMessages: notImpl('login.requestOldMessages'),
}

// ─── ipc.zalo ─────────────────────────────────────────────────────────────────
// Key: sendMessage — called as ipc.zalo.sendMessage({ auth, threadId, type, message })
// In the web version auth = { accountId: string } instead of { cookies, imei, userAgent }.

const zalo = {
  sendMessage: async (params: {
    auth: { accountId?: string; cookies?: string }
    threadId: string
    type: number
    message: string
  }) => {
    const accountId = params.auth?.accountId
    if (!accountId) {
      console.error('[ipc] zalo.sendMessage: auth.accountId is required in web version')
      return { success: false, error: 'accountId required' }
    }
    try {
      await apiClient.post(`/api/accounts/${accountId}/send`, {
        threadId: params.threadId,
        threadType: params.type,
        content: params.message,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  sendImage: async (params: {
    auth: { accountId?: string }
    threadId: string
    type: number
    imageData: string   // base64
    fileName?: string
  }) => {
    const accountId = params.auth?.accountId
    if (!accountId) return { success: false, error: 'accountId required' }
    try {
      await apiClient.post(`/api/accounts/${accountId}/send-image`, {
        threadId: params.threadId,
        threadType: params.type === 1 ? 'group' : 'user',
        imageBase64: params.imageData,
        fileName: params.fileName || 'image.jpg',
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  sendImages: notImpl('zalo.sendImages'),
  sendFile: notImpl('zalo.sendFile'),
  sendSticker: notImpl('zalo.sendSticker'),
  sendVoice: notImpl('zalo.sendVoice'),
  sendVideo: notImpl('zalo.sendVideo'),
  sendLink: notImpl('zalo.sendLink'),
  sendCard: notImpl('zalo.sendCard'),
  undoMessage: async (params: { auth: { accountId?: string }; msgId: string; threadId: string; type: number }) => {
    const accountId = params.auth?.accountId
    if (!accountId) return { success: false, error: 'accountId required' }
    try {
      await apiClient.post(`/api/accounts/${accountId}/recall`, {
        msgId: params.msgId,
        threadId: params.threadId,
        threadType: params.type === 1 ? 'group' : 'user',
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  recallMessage: async (params: { auth: { accountId?: string }; msgId: string; threadId: string; threadType?: number }) => {
    const accountId = params.auth?.accountId
    if (!accountId) return { success: false, error: 'accountId required' }
    try {
      await apiClient.post(`/api/accounts/${accountId}/recall`, {
        msgId: params.msgId,
        threadId: params.threadId,
        threadType: (params.threadType ?? 0) === 1 ? 'group' : 'user',
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  deleteMessage: notImpl('zalo.deleteMessage'),
  deleteChat: notImpl('zalo.deleteChat'),
  addReaction: notImpl('zalo.addReaction'),
  forwardMessage: notImpl('zalo.forwardMessage'),
  getFriends: notImpl('zalo.getFriends'),
  getGroups: notImpl('zalo.getGroups'),
  getUserInfo: notImpl('zalo.getUserInfo'),
  getContext: notImpl('zalo.getContext'),
  findUser: notImpl('zalo.findUser'),
  sendFriendRequest: async (params: { userId: string; message?: string }) => {
    try {
      // Caller should pass auth.accountId via addFriend endpoint
      return { success: false, error: 'use /api/accounts/:id/add-friend' }
    } catch { return { success: false } }
  },
  acceptFriendRequest: notImpl('zalo.acceptFriendRequest'),
  rejectFriendRequest: notImpl('zalo.rejectFriendRequest'),
  undoFriendRequest: notImpl('zalo.undoFriendRequest'),
  removeFriend: notImpl('zalo.removeFriend'),
  getSentFriendRequests: notImpl('zalo.getSentFriendRequests'),
  getFriendRequestStatus: notImpl('zalo.getFriendRequestStatus'),
  getFriendRecommendations: notImpl('zalo.getFriendRecommendations'),
  getAliasList: notImpl('zalo.getAliasList'),
  blockUser: notImpl('zalo.blockUser'),
  unblockUser: notImpl('zalo.unblockUser'),
  getRelatedFriendGroup: notImpl('zalo.getRelatedFriendGroup'),
  createGroup: notImpl('zalo.createGroup'),
  getGroupInfo: notImpl('zalo.getGroupInfo'),
  addUserToGroup: notImpl('zalo.addUserToGroup'),
  removeUserFromGroup: notImpl('zalo.removeUserFromGroup'),
  leaveGroup: notImpl('zalo.leaveGroup'),
  changeGroupName: notImpl('zalo.changeGroupName'),
  changeGroupAvatar: notImpl('zalo.changeGroupAvatar'),
  changeGroupOwner: notImpl('zalo.changeGroupOwner'),
  disperseGroup: notImpl('zalo.disperseGroup'),
  addGroupDeputy: notImpl('zalo.addGroupDeputy'),
  removeGroupDeputy: notImpl('zalo.removeGroupDeputy'),
  getGroupMembersInfo: notImpl('zalo.getGroupMembersInfo'),
  addGroupBlockedMember: notImpl('zalo.addGroupBlockedMember'),
  removeGroupBlockedMember: notImpl('zalo.removeGroupBlockedMember'),
  getGroupBlockedMember: notImpl('zalo.getGroupBlockedMember'),
  inviteUserToGroups: notImpl('zalo.inviteUserToGroups'),
  updateGroupSettings: notImpl('zalo.updateGroupSettings'),
  getGroupLinkDetail: notImpl('zalo.getGroupLinkDetail'),
  getGroupLinkInfo: notImpl('zalo.getGroupLinkInfo'),
  joinGroupLink: notImpl('zalo.joinGroupLink'),
  enableGroupLink: notImpl('zalo.enableGroupLink'),
  disableGroupLink: notImpl('zalo.disableGroupLink'),
  getPendingGroupMembers: notImpl('zalo.getPendingGroupMembers'),
  reviewPendingMemberRequest: notImpl('zalo.reviewPendingMemberRequest'),
  getMessageHistory: notImpl('zalo.getMessageHistory'),
  getGroupChatHistory: notImpl('zalo.getGroupChatHistory'),
  getPinConversations: notImpl('zalo.getPinConversations'),
  setPinConversation: notImpl('zalo.setPinConversation'),
  setMute: notImpl('zalo.setMute'),
  keepAlive: notImpl('zalo.keepAlive'),
  getLabels: notImpl('zalo.getLabels'),
  updateLabels: notImpl('zalo.updateLabels'),
  changeFriendAlias: notImpl('zalo.changeFriendAlias'),
  getStickers: notImpl('zalo.getStickers'),
  getStickersDetail: notImpl('zalo.getStickersDetail'),
  getStickerCategoryDetail: notImpl('zalo.getStickerCategoryDetail'),
  addUnreadMark: notImpl('zalo.addUnreadMark'),
  removeUnreadMark: notImpl('zalo.removeUnreadMark'),
  createPoll: notImpl('zalo.createPoll'),
  getPollDetail: notImpl('zalo.getPollDetail'),
  lockPoll: notImpl('zalo.lockPoll'),
  doVotePoll: notImpl('zalo.doVotePoll'),
  addPollOption: notImpl('zalo.addPollOption'),
  uploadVideoThumb: notImpl('zalo.uploadVideoThumb'),
  uploadVideoFile: notImpl('zalo.uploadVideoFile'),
  uploadVoiceFile: notImpl('zalo.uploadVoiceFile'),
  getQuickMessageList: notImpl('zalo.getQuickMessageList'),
  addQuickMessage: notImpl('zalo.addQuickMessage'),
  updateQuickMessage: notImpl('zalo.updateQuickMessage'),
  removeQuickMessage: notImpl('zalo.removeQuickMessage'),
  createNote: notImpl('zalo.createNote'),
  editNote: notImpl('zalo.editNote'),
  createReminder: notImpl('zalo.createReminder'),
  editReminder: notImpl('zalo.editReminder'),
  removeReminder: notImpl('zalo.removeReminder'),
  getListReminder: notImpl('zalo.getListReminder'),
  getReminder: notImpl('zalo.getReminder'),
  sendSeenEvent: notImpl('zalo.sendSeenEvent'),
  sendBankCard: notImpl('zalo.sendBankCard'),
}

// ─── ipc.db ───────────────────────────────────────────────────────────────────
// Reads contacts/messages from the in-memory chatStore.
// Drafts are persisted to localStorage.
// All other DB operations are stubs.

const db = {
  getContacts: async (zaloId: string) => {
    // Lazy import to avoid circular deps
    const { useChatStore } = await import('../stores/chatStore')
    const contacts = useChatStore.getState().contacts[zaloId] || []
    return { success: true, contacts }
  },

  getMessages: async (params: {
    zaloId: string
    threadId: string
    limit?: number
    offset?: number
    before?: string
  }) => {
    try {
      const limit = params.limit ?? 50
      const qs = new URLSearchParams({ limit: String(limit) })
      if (params.before) qs.set('before', params.before)
      const messages = await apiClient.get<unknown[]>(`/api/messages/${params.threadId}?${qs}`)
      return { success: true, messages }
    } catch {
      // Fallback to in-memory store
      const { useChatStore } = await import('../stores/chatStore')
      const key = `${params.zaloId}_${params.threadId}`
      const all = useChatStore.getState().messages[key] || []
      const limit = params.limit ?? 50
      const offset = params.offset ?? 0
      const slice = all.slice(Math.max(0, all.length - offset - limit), all.length - offset)
      return { success: true, messages: [...slice].reverse() }
    }
  },

  getThreads: async (_accountId?: string) => {
    try {
      const threads = await apiClient.get<unknown[]>('/api/messages/threads')
      return { success: true, threads }
    } catch (err) {
      return { success: false, threads: [], error: String(err) }
    }
  },

  getMessagesAround: notImpl('db.getMessagesAround'),

  markAsRead: async (params: { zaloId: string; contactId: string }) => {
    try {
      await apiClient.patch(`/api/messages/${params.contactId}/read`, {})
    } catch { /* best-effort */ }
    const { useChatStore } = await import('../stores/chatStore')
    useChatStore.getState().clearUnread(params.zaloId, params.contactId)
    return { success: true }
  },

  getUnreadCount: async (zaloId: string) => {
    const { useChatStore } = await import('../stores/chatStore')
    const contacts = useChatStore.getState().contacts[zaloId] || []
    const count = contacts.reduce((n, c) => n + (c.unread_count || 0), 0)
    return { success: true, count }
  },

  // Drafts — REST API (accountId = zaloId in web context)
  upsertDraft: async (params: { zaloId: string; threadId: string; content: string }) => {
    try {
      await apiClient.put('/api/drafts', {
        accountId: params.zaloId,
        threadId: params.threadId,
        content: params.content,
      })
    } catch {
      // best-effort; also mirror to localStorage as fallback
      lsSet(`draft:${params.zaloId}:${params.threadId}`, JSON.stringify({ content: params.content, updatedAt: Date.now() }))
    }
    return { success: true }
  },
  deleteDraft: async (params: { zaloId: string; threadId: string }) => {
    try {
      await apiClient.del(`/api/drafts?accountId=${params.zaloId}&threadId=${encodeURIComponent(params.threadId)}`)
    } catch { /* best-effort */ }
    lsRemove(`draft:${params.zaloId}:${params.threadId}`)
    return { success: true }
  },
  getDraft: async (params: { zaloId: string; threadId: string }) => {
    try {
      const draft = await apiClient.get<{ content: string; updatedAt: string } | null>(
        `/api/drafts?accountId=${params.zaloId}&threadId=${encodeURIComponent(params.threadId)}`,
      )
      if (!draft) return { success: true, draft: null }
      return { success: true, draft: { content: draft.content, updatedAt: new Date(draft.updatedAt).getTime() } }
    } catch {
      // fallback to localStorage
      const raw = lsGet(`draft:${params.zaloId}:${params.threadId}`)
      if (!raw) return { success: true, draft: null }
      try { return { success: true, draft: JSON.parse(raw) as { content: string; updatedAt: number } } }
      catch { return { success: true, draft: null } }
    }
  },
  getDrafts: async (params: { zaloId: string }) => {
    // Best-effort: local fallback only (no bulk draft API)
    const prefix = `draft:${params.zaloId}:`
    const drafts: Array<{ threadId: string; content: string; updatedAt: number }> = []
    for (const key of lsKeys()) {
      if (!key.startsWith(prefix)) continue
      const threadId = key.slice(prefix.length)
      const raw = lsGet(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as { content: string; updatedAt: number }
        drafts.push({ threadId, ...parsed })
      } catch {}
    }
    return { success: true, drafts }
  },
  deleteOldDrafts: async () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const key of lsKeys()) {
      if (!key.startsWith('draft:')) continue
      const raw = lsGet(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as { updatedAt?: number }
        if ((parsed.updatedAt ?? 0) < cutoff) lsRemove(key)
      } catch { lsRemove(key) }
    }
    return { success: true }
  },

  // Stubs for everything else
  searchMessages: notImpl('db.searchMessages'),
  getMediaMessages: notImpl('db.getMediaMessages'),
  getFileMessages: notImpl('db.getFileMessages'),
  markMessageRecalled: notImpl('db.markMessageRecalled'),
  deleteMessages: notImpl('db.deleteMessages'),
  updateContactProfile: notImpl('db.updateContactProfile'),
  updateAccountPhone: notImpl('db.updateAccountPhone'),
  updateReaction: notImpl('db.updateReaction'),
  updateLocalPaths: notImpl('db.updateLocalPaths'),
  getMessageById: notImpl('db.getMessageById'),
  getStoragePath: notImpl('db.getStoragePath'),
  setStoragePath: notImpl('db.setStoragePath'),
  selectStorageFolder: notImpl('db.selectStorageFolder'),
  getFriends: notImpl('db.getFriends'),
  saveFriends: notImpl('db.saveFriends'),
  isFriend: notImpl('db.isFriend'),
  getFriendRequests: notImpl('db.getFriendRequests'),
  saveFriendRequests: notImpl('db.saveFriendRequests'),
  upsertFriendRequest: notImpl('db.upsertFriendRequest'),
  removeFriendRequest: notImpl('db.removeFriendRequest'),
  addFriend: notImpl('db.addFriend'),
  removeFriend: notImpl('db.removeFriend'),
  deleteConversation: notImpl('db.deleteConversation'),
  getLinks: notImpl('db.getLinks'),
  saveLink: notImpl('db.saveLink'),
  getGroupMembers: notImpl('db.getGroupMembers'),
  getAllGroupMembers: notImpl('db.getAllGroupMembers'),
  saveGroupMembers: notImpl('db.saveGroupMembers'),
  upsertGroupMember: notImpl('db.upsertGroupMember'),
  removeGroupMember: notImpl('db.removeGroupMember'),
  saveStickers: notImpl('db.saveStickers'),
  getStickerById: notImpl('db.getStickerById'),
  getRecentStickers: notImpl('db.getRecentStickers'),
  addRecentSticker: notImpl('db.addRecentSticker'),
  markStickerUnsupported: notImpl('db.markStickerUnsupported'),
  saveStickerPacks: notImpl('db.saveStickerPacks'),
  getStickerPacks: notImpl('db.getStickerPacks'),
  getStickersByPackId: notImpl('db.getStickersByPackId'),
  saveKeywordStickers: notImpl('db.saveKeywordStickers'),
  getKeywordStickers: notImpl('db.getKeywordStickers'),
  getStickersByIds: notImpl('db.getStickersByIds'),
  getAllCachedPackSummaries: notImpl('db.getAllCachedPackSummaries'),
  getPinnedMessages: async (params: { zaloId: string; threadId: string }) => {
    try {
      const pins = await apiClient.get<unknown[]>(
        `/api/messages/${encodeURIComponent(params.threadId)}/pinned?accountId=${params.zaloId}`,
      )
      return { success: true, pins }
    } catch {
      return { success: true, pins: [] }
    }
  },
  getMessagesByType: notImpl('db.getMessagesByType'),
  pinMessage: async (params: { zaloId: string; threadId: string; msgId: string }) => {
    try {
      await apiClient.post(`/api/messages/${encodeURIComponent(params.threadId)}/pin`, {
        msgId: params.msgId,
        accountId: params.zaloId,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  unpinMessage: async (params: { zaloId: string; threadId: string; msgId: string }) => {
    try {
      await apiClient.del(
        `/api/messages/${encodeURIComponent(params.threadId)}/pin/${encodeURIComponent(params.msgId)}?accountId=${params.zaloId}`,
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  bringPinnedToTop: async (params: { zaloId: string; threadId: string; msgId: string }) => {
    // Re-pin to update pinnedAt timestamp
    try {
      await apiClient.post(`/api/messages/${encodeURIComponent(params.threadId)}/pin`, {
        msgId: params.msgId,
        accountId: params.zaloId,
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  getLocalQuickMessages: async (_params?: { zaloId?: string }) => {
    try {
      const items = await apiClient.get<Array<{ id: string; keyword: string; title: string; content?: string; mediaUrl?: string }>>('/api/quick-messages')
      // Map backend shape → desktop QuickMessage shape
      const mapped = items.map((i) => ({
        id: i.id as unknown as number,
        keyword: i.keyword,
        message: { title: i.title },
        media: null,
        _local: true,
      }))
      return { success: true, items: mapped }
    } catch {
      return { success: true, items: [] }
    }
  },
  getAllLocalQuickMessages: async () => {
    try {
      const items = await apiClient.get<Array<{ id: string; keyword: string; title: string }>>('/api/quick-messages')
      const mapped = items.map((i) => ({ id: i.id as unknown as number, keyword: i.keyword, message: { title: i.title }, media: null, _local: true }))
      return { success: true, items: mapped }
    } catch {
      return { success: true, items: [] }
    }
  },
  upsertLocalQuickMessage: async (params: { zaloId?: string; item: { keyword: string; title: string; id?: number; media?: unknown } }) => {
    try {
      if (params.item.id) {
        await apiClient.put(`/api/quick-messages/${params.item.id}`, { keyword: params.item.keyword, title: params.item.title })
      } else {
        await apiClient.post('/api/quick-messages', { keyword: params.item.keyword, title: params.item.title })
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  deleteLocalQuickMessage: async (params: { zaloId?: string; id: number | string }) => {
    try {
      await apiClient.del(`/api/quick-messages/${params.id}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  bulkReplaceLocalQuickMessages: notImpl('db.bulkReplaceLocalQuickMessages'),
  cloneLocalQuickMessages: notImpl('db.cloneLocalQuickMessages'),
  setLocalQMActive: notImpl('db.setLocalQMActive'),
  setLocalQMOrder: notImpl('db.setLocalQMOrder'),
  setContactFlags: notImpl('db.setContactFlags'),
  getContactsWithFlags: notImpl('db.getContactsWithFlags'),
  setContactAlias: notImpl('db.setContactAlias'),
  getBankCards: notImpl('db.getBankCards'),
  upsertBankCard: notImpl('db.upsertBankCard'),
  deleteBankCard: notImpl('db.deleteBankCard'),
  getLocalPinnedConversations: notImpl('db.getLocalPinnedConversations'),
  setLocalPinnedConversation: notImpl('db.setLocalPinnedConversation'),
  getNotifSettings: notImpl('db.getNotifSettings'),
  setNotifSettings: notImpl('db.setNotifSettings'),
  getLocalLabels: notImpl('db.getLocalLabels'),
  upsertLocalLabel: notImpl('db.upsertLocalLabel'),
  deleteLocalLabel: notImpl('db.deleteLocalLabel'),
  cloneLocalLabels: notImpl('db.cloneLocalLabels'),
  getLocalLabelThreads: notImpl('db.getLocalLabelThreads'),
  assignLocalLabelToThread: notImpl('db.assignLocalLabelToThread'),
  removeLocalLabelFromThread: notImpl('db.removeLocalLabelFromThread'),
  getThreadLocalLabels: notImpl('db.getThreadLocalLabels'),
  setLocalLabelActive: notImpl('db.setLocalLabelActive'),
  setLocalLabelOrder: notImpl('db.setLocalLabelOrder'),
}

// ─── ipc.crm ─────────────────────────────────────────────────────────────────
// Contacts, labels, and notes — backed by REST API (/api/contacts, /api/labels)

// Shape returned by GET /api/contacts
interface ApiContact {
  id: string
  zaloUid: string
  phone: string | null
  displayName: string | null
  realName: string | null
  avatarUrl: string | null
  source: string | null
  labels: Array<{ contactId: string; labelId: string; label: { id: string; name: string; color: string } }>
  _count: { contactNotes: number }
  updatedAt: string
}

// Map DB contact → CRMContact shape that components expect
function mapContact(c: ApiContact) {
  return {
    contact_id: c.id,
    zalo_uid: c.zaloUid,
    display_name: c.displayName ?? c.zaloUid,
    alias: c.realName ?? '',
    avatar: c.avatarUrl ?? '',
    phone: c.phone ?? '',
    contact_type: 'friend' as const,
    last_message_time: c.updatedAt ? new Date(c.updatedAt).getTime() : 0,
    note_count: c._count?.contactNotes ?? 0,
    labels: (c.labels ?? []).map((cl) => ({ id: cl.label.id, name: cl.label.name, color: cl.label.color })),
  }
}

const crm = {
  // Fetch contact list with optional search/label filter
  getContacts: async (params?: { zaloId?: string; opts?: { search?: string; labelId?: string; limit?: number; offset?: number } }) => {
    try {
      const qs = new URLSearchParams()
      if (params?.opts?.search) qs.set('search', params.opts.search)
      if (params?.opts?.labelId) qs.set('labelId', params.opts.labelId)
      if (params?.opts?.limit != null) qs.set('limit', String(params.opts.limit))
      if (params?.opts?.offset != null) qs.set('offset', String(params.opts.offset))
      const result = await apiClient.get<{ contacts: ApiContact[]; total: number }>(`/api/contacts?${qs}`)
      return { success: true, contacts: result.contacts.map(mapContact), total: result.total }
    } catch (err) {
      return { success: false as const, contacts: [], total: 0, error: String(err) }
    }
  },

  // Fetch notes for a contact
  getNotes: async (params: { zaloId?: string; contactId: string }) => {
    try {
      const raw = await apiClient.get<Array<{ id: string; contactId: string; content: string; createdAt: string; updatedAt: string }>>(
        `/api/contacts/${params.contactId}/notes`,
      )
      const notes = raw.map((n) => ({
        id: n.id,
        contact_id: n.contactId,
        content: n.content,
        created_at: new Date(n.createdAt).getTime(),
        updated_at: new Date(n.updatedAt).getTime(),
      }))
      return { success: true, notes }
    } catch (err) {
      return { success: false as const, notes: [], error: String(err) }
    }
  },

  // Create a note; id in note means update (not supported in web yet — creates new)
  saveNote: async (params: { zaloId?: string; note: { id?: string; contact_id: string; content: string } }) => {
    try {
      // TODO: PUT /api/contacts/:id/notes/:noteId for editing existing notes
      await apiClient.post(`/api/contacts/${params.note.contact_id}/notes`, { content: params.note.content })
      return { success: true }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Delete a note — contactId optional (web uses /api/notes/:noteId fallback)
  deleteNote: async (params: { zaloId?: string; noteId: string; contactId?: string }) => {
    try {
      if (params.contactId) {
        await apiClient.del(`/api/contacts/${params.contactId}/notes/${params.noteId}`)
      } else {
        await apiClient.del(`/api/notes/${params.noteId}`)
      }
      return { success: true }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Assign a label to a contact
  assignLabel: async (contactId: string, labelId: string) => {
    try {
      await apiClient.post(`/api/contacts/${contactId}/labels`, { labelId })
      return { success: true }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Remove a label from a contact
  removeLabel: async (contactId: string, labelId: string) => {
    try {
      await apiClient.del(`/api/contacts/${contactId}/labels/${labelId}`)
      return { success: true }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Fetch all tenant labels
  getLabels: async () => {
    try {
      const labels = await apiClient.get<Array<{ id: string; name: string; color: string }>>('/api/labels')
      return { success: true, labels }
    } catch (err) {
      return { success: false as const, labels: [], error: String(err) }
    }
  },

  // Create a new label
  addLabel: async (name: string, color?: string) => {
    try {
      const label = await apiClient.post<{ id: string; name: string; color: string }>('/api/labels', { name, color })
      return { success: true, label }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Delete a label
  deleteLabel: async (id: string) => {
    try {
      await apiClient.del(`/api/labels/${id}`)
      return { success: true }
    } catch (err) {
      return { success: false as const, error: String(err) }
    }
  },

  // Stubs for campaign/analytics features not yet implemented in web
  getContactStats: notImpl('crm.getContactStats'),
  getCampaigns: notImpl('crm.getCampaigns'),
  saveCampaign: notImpl('crm.saveCampaign'),
  deleteCampaign: notImpl('crm.deleteCampaign'),
  cloneCampaign: notImpl('crm.cloneCampaign'),
  updateCampaignStatus: notImpl('crm.updateCampaignStatus'),
  addCampaignContacts: notImpl('crm.addCampaignContacts'),
  getCampaignContacts: notImpl('crm.getCampaignContacts'),
  getSendLog: async () => ({ success: true, logs: [] }),
  getQueueStatus: async () => ({ success: true, status: null }),
  getCampaignStats: notImpl('crm.getCampaignStats'),
  getActivityStats: notImpl('crm.getActivityStats'),
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const ipc = {
  login,
  zalo,
  db,
  crm,

  // Event bus — ipc.on(channel, cb) returns an unsubscribe function
  on: onEvent,
  removeAllListeners: (channel: string) => _listeners.delete(channel),

  // Stubs for Electron-only namespaces
  file: {
    openDialog: notImpl('file.openDialog'),
    saveImage: notImpl('file.saveImage'),
    getAppDataPath: notImpl('file.getAppDataPath'),
    openPath: notImpl('file.openPath'),
    showItemInFolder: notImpl('file.showItemInFolder'),
    saveAs: notImpl('file.saveAs'),
    saveTempBlob: notImpl('file.saveTempBlob'),
    getVideoMeta: notImpl('file.getVideoMeta'),
    readImageAsBase64: notImpl('file.readImageAsBase64'),
    repairImage: notImpl('file.repairImage'),
    validateLocalImages: notImpl('file.validateLocalImages'),
    captureScreenshot: notImpl('file.captureScreenshot'),
  },
  app: {
    setBadge: () => {},
    openThread: () => {},
    sendBadgeImage: () => {},
    flashFrame: () => {},
  },
  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    quit: () => {},
    isMaximized: async () => false,
  },
  shell: {
    openExternal: (url: string) => { if (typeof window !== 'undefined') window.open(url, '_blank') },
    openPath: notImpl('shell.openPath'),
    openInApp: notImpl('shell.openInApp'),
  },
  util: {
    fetchUrl: notImpl('util.fetchUrl'),
  },
  update: {
    download: async () => {},
    install: async () => {},
    checkForUpdates: async () => ({ success: false, error: 'not implemented' }),
  },
  lockScreen: {
    status: async () => ({ success: true, enabled: false, isLocked: false, hasPassword: false }),
    setup: async () => ({ success: false, error: 'not implemented' }),
    verify: async () => ({ success: false, error: 'not implemented' }),
    verifyRecovery: async () => ({ success: false, error: 'not implemented' }),
    changePassword: async () => ({ success: false, error: 'not implemented' }),
    resetPassword: async () => ({ success: false, error: 'not implemented' }),
    disable: async () => ({ success: false, error: 'not implemented' }),
    getRecoveryKey: async () => ({ success: false, error: 'not implemented' }),
    setBiometric: async () => ({ success: false, error: 'not implemented' }),
    biometricUnlock: async () => ({ success: false, error: 'not implemented' }),
  },
  erp: {
    notifyUnreadCount: async () => 0,
    getPermissions: async () => ({ success: true, permissions: [] }),
    checkPermission: async () => ({ success: true, granted: false }),
  },
  tunnel: {
    start: async () => ({ success: false, error: 'not implemented' }),
    stop: async () => {},
    status: async () => ({ running: false }),
    getUrl: async () => ({ success: false, url: null }),
  },
  relay: {
    startServer: async () => ({ success: false, error: 'not implemented' }),
    stopServer: async () => {},
    status: async () => ({ running: false }),
    kickEmployee: async () => ({ success: false }),
    getConnections: async () => ({ success: true, connections: [] }),
  },
  analytics: {} as Record<string, ReturnType<typeof notImpl>>,
  workflow: {} as Record<string, ReturnType<typeof notImpl>>,
  integration: {} as Record<string, ReturnType<typeof notImpl>>,
  ai: {} as Record<string, ReturnType<typeof notImpl>>,
  employee: {} as Record<string, ReturnType<typeof notImpl>>,
  workspace: {} as Record<string, ReturnType<typeof notImpl>>,
  sync: {} as Record<string, ReturnType<typeof notImpl>>,
  fb: {} as Record<string, ReturnType<typeof notImpl>>,
  proxy: {} as Record<string, ReturnType<typeof notImpl>>,
}

// Proxy wrapper: auto-stub bất kỳ namespace hoặc method nào chưa có,
// tránh lỗi "X is not a function" khi desktop components gọi method chưa implement.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcProxy = new Proxy(ipc as any, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(target: any, namespace: string) {
    if (namespace in target) {
      const val = target[namespace]
      // Nếu namespace là object (không phải function/primitive), bọc thêm 1 lớp Proxy
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return new Proxy(val, {
          get(ns: Record<string, unknown>, method: string) {
            if (method in ns) return ns[method]
            // Method chưa có → trả function stub
            return (..._args: unknown[]) => {
              if (process.env.NODE_ENV !== 'production') {
                console.warn(`[ipc] stub: ${namespace}.${method}`)
              }
              return Promise.resolve({ success: false, error: 'not_implemented' })
            }
          },
        })
      }
      return val
    }
    // Namespace chưa có → trả object stub với mọi property là function
    return new Proxy({} as Record<string, unknown>, {
      get(_t, method: string) {
        return (..._args: unknown[]) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`[ipc] stub: ${namespace}.${method}`)
          }
          return Promise.resolve({ success: false, error: 'not_implemented' })
        }
      },
    })
  },
})

export default ipcProxy
