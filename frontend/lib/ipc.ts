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
      const accounts = await apiClient.get<unknown[]>('/api/accounts')
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
  loginQR: notImpl('login.loginQR'),
  loginQRAbort: notImpl('login.loginQRAbort'),
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
  sendImage: notImpl('zalo.sendImage'),
  sendImages: notImpl('zalo.sendImages'),
  sendFile: notImpl('zalo.sendFile'),
  sendSticker: notImpl('zalo.sendSticker'),
  sendVoice: notImpl('zalo.sendVoice'),
  sendVideo: notImpl('zalo.sendVideo'),
  sendLink: notImpl('zalo.sendLink'),
  sendCard: notImpl('zalo.sendCard'),
  undoMessage: notImpl('zalo.undoMessage'),
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

  // Drafts — localStorage
  upsertDraft: async (params: { zaloId: string; threadId: string; content: string }) => {
    lsSet(`draft:${params.zaloId}:${params.threadId}`, JSON.stringify({ content: params.content, updatedAt: Date.now() }))
    return { success: true }
  },
  deleteDraft: async (params: { zaloId: string; threadId: string }) => {
    lsRemove(`draft:${params.zaloId}:${params.threadId}`)
    return { success: true }
  },
  getDraft: async (params: { zaloId: string; threadId: string }) => {
    const raw = lsGet(`draft:${params.zaloId}:${params.threadId}`)
    if (!raw) return { success: true, draft: null }
    try { return { success: true, draft: JSON.parse(raw) as { content: string; updatedAt: number } } }
    catch { return { success: true, draft: null } }
  },
  getDrafts: async (params: { zaloId: string }) => {
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
  getPinnedMessages: notImpl('db.getPinnedMessages'),
  getMessagesByType: notImpl('db.getMessagesByType'),
  pinMessage: notImpl('db.pinMessage'),
  unpinMessage: notImpl('db.unpinMessage'),
  bringPinnedToTop: notImpl('db.bringPinnedToTop'),
  getLocalQuickMessages: notImpl('db.getLocalQuickMessages'),
  getAllLocalQuickMessages: notImpl('db.getAllLocalQuickMessages'),
  upsertLocalQuickMessage: notImpl('db.upsertLocalQuickMessage'),
  deleteLocalQuickMessage: notImpl('db.deleteLocalQuickMessage'),
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

// ─── ipc.crm / ipc.analytics / others — all stubs ────────────────────────────

const crm = {
  getNotes: notImpl('crm.getNotes'),
  saveNote: notImpl('crm.saveNote'),
  deleteNote: notImpl('crm.deleteNote'),
  getContacts: notImpl('crm.getContacts'),
  getContactStats: notImpl('crm.getContactStats'),
  getCampaigns: notImpl('crm.getCampaigns'),
  saveCampaign: notImpl('crm.saveCampaign'),
  deleteCampaign: notImpl('crm.deleteCampaign'),
  cloneCampaign: notImpl('crm.cloneCampaign'),
  updateCampaignStatus: notImpl('crm.updateCampaignStatus'),
  addCampaignContacts: notImpl('crm.addCampaignContacts'),
  getCampaignContacts: notImpl('crm.getCampaignContacts'),
  getSendLog: notImpl('crm.getSendLog'),
  getQueueStatus: notImpl('crm.getQueueStatus'),
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
  analytics: {} as Record<string, ReturnType<typeof notImpl>>,
  workflow: {} as Record<string, ReturnType<typeof notImpl>>,
  integration: {} as Record<string, ReturnType<typeof notImpl>>,
  ai: {} as Record<string, ReturnType<typeof notImpl>>,
  tunnel: {} as Record<string, ReturnType<typeof notImpl>>,
  employee: {} as Record<string, ReturnType<typeof notImpl>>,
  workspace: {} as Record<string, ReturnType<typeof notImpl>>,
  sync: {} as Record<string, ReturnType<typeof notImpl>>,
  relay: {} as Record<string, ReturnType<typeof notImpl>>,
  fb: {} as Record<string, ReturnType<typeof notImpl>>,
  proxy: {} as Record<string, ReturnType<typeof notImpl>>,
  erp: {} as Record<string, ReturnType<typeof notImpl>>,
  lockScreen: {} as Record<string, ReturnType<typeof notImpl>>,
}

export default ipc
