// ── Session ──────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'initializing'
  | 'qr_pending'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'terminated'

export interface SessionRecord {
  accountId: string
  zaloUserId: string
  phone: string
  status: SessionStatus
  pid?: number
  workerId: string
  connectedAt?: number
  lastHeartbeat: number
  errorCount: number
  metadata?: {
    displayName?: string
    avatarUrl?: string
  }
}

// ── Worker IPC — Commands ─────────────────────────────────────────────────────

export interface WorkerCommandLoginQr {
  type: 'LOGIN_QR'
}

export interface WorkerCommandLoginCookie {
  type: 'LOGIN_COOKIE'
  payload: {
    cookie: Record<string, unknown>
    imei: string
    userAgent: string
  }
}

export interface WorkerCommandSendMessage {
  type: 'SEND_MESSAGE'
  payload: {
    threadId: string
    threadType: 'user' | 'group'
    content: string
    quoteMessageId?: string
  }
}

export interface WorkerCommandAddFriend {
  type: 'ADD_FRIEND'
  payload: {
    userId: string
    message?: string
  }
}

export interface WorkerCommandShutdown {
  type: 'SHUTDOWN'
}

export interface WorkerCommandHeartbeat {
  type: 'HEARTBEAT'
}

export type WorkerCommand =
  | WorkerCommandLoginQr
  | WorkerCommandLoginCookie
  | WorkerCommandSendMessage
  | WorkerCommandAddFriend
  | WorkerCommandShutdown
  | WorkerCommandHeartbeat

// ── Worker IPC — Events ───────────────────────────────────────────────────────

export interface WorkerEventQrCode {
  type: 'QR_CODE'
  payload: {
    qrDataUrl: string
  }
}

export interface WorkerEventLoginSuccess {
  type: 'LOGIN_SUCCESS'
  payload: {
    userId: string
    displayName: string
  }
}

export interface WorkerEventLoginFailed {
  type: 'LOGIN_FAILED'
  error: string
}

export interface WorkerEventMessageIncoming {
  type: 'MESSAGE_INCOMING'
  payload: IncomingMessage
}

export interface WorkerEventMessageSent {
  type: 'MESSAGE_SENT'
  payload: {
    msgId: string
    threadId: string
  }
}

export interface WorkerEventMessageError {
  type: 'MESSAGE_ERROR'
  error: string
  context?: Record<string, unknown>
}

export interface WorkerEventDisconnected {
  type: 'DISCONNECTED'
  reason: string
}

export interface WorkerEventHeartbeatAck {
  type: 'HEARTBEAT_ACK'
  timestamp: number
}

export interface WorkerEventError {
  type: 'ERROR'
  error: string
  fatal: boolean
}

export type WorkerEvent =
  | WorkerEventQrCode
  | WorkerEventLoginSuccess
  | WorkerEventLoginFailed
  | WorkerEventMessageIncoming
  | WorkerEventMessageSent
  | WorkerEventMessageError
  | WorkerEventDisconnected
  | WorkerEventHeartbeatAck
  | WorkerEventError

// ── Message ───────────────────────────────────────────────────────────────────

export interface IncomingMessage {
  msgId: string
  threadId: string
  threadType: 'user' | 'group'
  fromUserId: string
  content: string | Record<string, unknown>
  timestamp: number
  isGroup: boolean
  senderName?: string
}

// ── Vault ─────────────────────────────────────────────────────────────────────

export interface ZaloCreds {
  cookie: Record<string, unknown>
  imei: string
  userAgent: string
  capturedAt: number
}

export interface StoredCreds {
  accountId: string
  tenantId: string
  /** hex-encoded: iv(12 bytes) + authTag(16 bytes) + ciphertext */
  encryptedBlob: string
  version: number
  createdAt: number
  updatedAt: number
}

export interface WorkerCredToken {
  tokenId: string
  accountId: string
  tenantId: string
  expiresAt: number
}

// ── Pool Config ───────────────────────────────────────────────────────────────

export interface PoolConfig {
  maxWorkers: number
  heartbeatIntervalMs: number
  maxErrorsBeforeKill: number
  spawnTimeoutMs: number
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxWorkers: 100,
  heartbeatIntervalMs: 30_000,
  maxErrorsBeforeKill: 5,
  spawnTimeoutMs: 20_000,
}

// ── API ───────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
}
