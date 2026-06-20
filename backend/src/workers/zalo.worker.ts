import fs from 'fs'
import os from 'os'
import path from 'path'
import { Zalo, ThreadType, LoginQRCallbackEventType } from 'zca-js'
import type { API } from 'zca-js'
import type { LoginQRCallbackEvent } from 'zca-js'
import type {
  WorkerCommand,
  WorkerEvent,
  ZaloCreds,
  IncomingMessage,
} from '../types'

// ── Env ───────────────────────────────────────────────────────────────────────

const ACCOUNT_ID = process.env['ACCOUNT_ID'] ?? ''
const WORKER_ID = process.env['WORKER_ID'] ?? ''
const TENANT_ID = process.env['TENANT_ID'] ?? ''
const VAULT_TOKEN_ID = process.env['VAULT_TOKEN_ID'] ?? ''
const VAULT_INTERNAL_URL = process.env['VAULT_INTERNAL_URL'] ?? 'http://127.0.0.1:3001'

void WORKER_ID // used via env, keep to avoid unused warning

// ── State ─────────────────────────────────────────────────────────────────────

let api: API | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

let msgCount = 0
let msgWindowStart = Date.now()
const MAX_MSG_PER_MINUTE = 20

// ── IPC helpers ───────────────────────────────────────────────────────────────

function emit(event: WorkerEvent): void {
  process.send?.(event)
}

function emitError(error: string, fatal: boolean): void {
  emit({ type: 'ERROR', error, fatal })
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

function checkRateLimit(): boolean {
  const now = Date.now()
  if (now - msgWindowStart >= 60_000) {
    msgCount = 0
    msgWindowStart = now
  }
  if (msgCount >= MAX_MSG_PER_MINUTE) return false
  msgCount++
  return true
}

// ── Vault ─────────────────────────────────────────────────────────────────────

async function fetchCredsFromVault(): Promise<ZaloCreds> {
  const res = await fetch(`${VAULT_INTERNAL_URL}/internal/vault/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenId: VAULT_TOKEN_ID, accountId: ACCOUNT_ID, tenantId: TENANT_ID }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Vault fetch failed (${res.status}): ${text}`)
  }

  return (await res.json()) as ZaloCreds
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    emit({ type: 'HEARTBEAT_ACK', timestamp: Date.now() })
  }, 15_000)
}

// ── Listeners ─────────────────────────────────────────────────────────────────

function attachListeners(zaloApi: API): void {
  zaloApi.listener.on('message', (msg) => {
    const isGroup = msg.type === ThreadType.Group
    const data = msg.data

    const incoming: IncomingMessage = {
      msgId: data.msgId,
      threadId: msg.threadId,
      threadType: isGroup ? 'group' : 'user',
      fromUserId: data.uidFrom,
      content: data.content,
      timestamp: Number(data.ts),
      isGroup,
      senderName: data.dName || undefined,
    }

    emit({ type: 'MESSAGE_INCOMING', payload: incoming })
  })

  zaloApi.listener.on('disconnected', (_code, reason) => {
    emit({ type: 'DISCONNECTED', reason })
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  })

  // Zalo kills the listener when another web session opens
  zaloApi.listener.on('closed', (_code, reason) => {
    emit({ type: 'DISCONNECTED', reason: `closed: ${reason}` })
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  })

  zaloApi.listener.on('error', (err) => {
    emitError(err instanceof Error ? err.message : String(err), false)
  })

  zaloApi.listener.start({ retryOnClose: false })
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function loginQR(): Promise<void> {
  const zalo = new Zalo()
  let resolvedApi: API | null = null

  try {
    resolvedApi = await zalo.loginQR(
      {},
      (event: LoginQRCallbackEvent) => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          emit({ type: 'QR_CODE', payload: { qrDataUrl: event.data.image } })
        }
      },
    )
  } catch (err) {
    emit({ type: 'LOGIN_FAILED', error: err instanceof Error ? err.message : String(err) })
    return
  }

  if (!resolvedApi) { emit({ type: 'LOGIN_FAILED', error: 'loginQR returned null' }); return }

  api = resolvedApi
  const info = await api.fetchAccountInfo()
  emit({ type: 'LOGIN_SUCCESS', payload: { userId: info.profile.userId, displayName: info.profile.displayName } })
  startHeartbeat()
  attachListeners(api)
}

async function loginWithCookie(): Promise<void> {
  let creds: ZaloCreds
  try {
    creds = await fetchCredsFromVault()
  } catch (err) {
    emit({ type: 'LOGIN_FAILED', error: err instanceof Error ? err.message : String(err) })
    return
  }

  const zalo = new Zalo()
  try {
    api = await zalo.login({
      cookie: creds.cookie as Parameters<typeof zalo.login>[0]['cookie'],
      imei: creds.imei,
      userAgent: creds.userAgent,
    })
  } catch (err) {
    emit({ type: 'LOGIN_FAILED', error: err instanceof Error ? err.message : String(err) })
    return
  }

  const info = await api.fetchAccountInfo()
  emit({ type: 'LOGIN_SUCCESS', payload: { userId: info.profile.userId, displayName: info.profile.displayName } })
  startHeartbeat()
  attachListeners(api)
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'LOGIN_QR':
      await loginQR()
      break

    case 'LOGIN_COOKIE':
      await loginWithCookie()
      break

    case 'SEND_MESSAGE': {
      if (!api) { emit({ type: 'MESSAGE_ERROR', error: 'API not ready', context: { cmd } }); return }
      if (!checkRateLimit()) {
        emit({ type: 'MESSAGE_ERROR', error: `Rate limit: max ${MAX_MSG_PER_MINUTE} msg/min`, context: { threadId: cmd.payload.threadId } })
        return
      }
      const { threadId, threadType, content } = cmd.payload
      const type = threadType === 'group' ? ThreadType.Group : ThreadType.User
      try {
        const res = await api.sendMessage({ msg: content }, threadId, type)
        const msgId = res.message?.msgId?.toString() ?? ''
        emit({ type: 'MESSAGE_SENT', payload: { msgId, threadId } })
      } catch (err) {
        emit({ type: 'MESSAGE_ERROR', error: err instanceof Error ? err.message : String(err), context: { threadId } })
      }
      break
    }

    case 'SEND_IMAGE': {
      if (!api) { emit({ type: 'MESSAGE_ERROR', error: 'API not ready', context: { cmd } }); return }
      if (!checkRateLimit()) {
        emit({ type: 'MESSAGE_ERROR', error: `Rate limit: max ${MAX_MSG_PER_MINUTE} msg/min`, context: { threadId: cmd.payload.threadId } })
        return
      }
      const { threadId: imgThreadId, threadType: imgThreadType, imageBase64, fileName } = cmd.payload
      const tmpPath = path.join(os.tmpdir(), `zalo_img_${Date.now()}_${fileName}`)
      try {
        const buf = Buffer.from(imageBase64, 'base64')
        fs.writeFileSync(tmpPath, buf)
        const type = imgThreadType === 'group' ? ThreadType.Group : ThreadType.User
        // zca-js sendImage signature may differ — wrap with error handling
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (api as any).sendImage(tmpPath, imgThreadId, type)
        const msgId = res?.message?.msgId?.toString() ?? ''
        emit({ type: 'MESSAGE_SENT', payload: { msgId, threadId: imgThreadId } })
      } catch (err) {
        emit({ type: 'MESSAGE_ERROR', error: err instanceof Error ? err.message : String(err), context: { threadId: imgThreadId } })
      } finally {
        try { fs.unlinkSync(tmpPath) } catch {}
      }
      break
    }

    case 'RECALL_MESSAGE': {
      if (!api) { emit({ type: 'MESSAGE_ERROR', error: 'API not ready', context: { cmd } }); return }
      const { msgId: recallMsgId, threadId: recallThreadId, threadType: recallThreadType } = cmd.payload
      try {
        const type = recallThreadType === 'group' ? ThreadType.Group : ThreadType.User
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (api as any).undoMessage(recallMsgId, recallThreadId, type)
      } catch (err) {
        emit({ type: 'MESSAGE_ERROR', error: err instanceof Error ? err.message : String(err), context: { threadId: recallThreadId } })
      }
      break
    }

    case 'ADD_FRIEND': {
      if (!api) { emit({ type: 'MESSAGE_ERROR', error: 'API not ready', context: { cmd } }); return }
      const { userId, message = '' } = cmd.payload
      try {
        await api.sendFriendRequest(message, userId)
      } catch (err) {
        emitError(err instanceof Error ? err.message : String(err), false)
      }
      break
    }

    case 'HEARTBEAT':
      emit({ type: 'HEARTBEAT_ACK', timestamp: Date.now() })
      break

    case 'SHUTDOWN':
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      api?.listener.stop()
      process.exit(0)
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

process.on('message', (cmd: WorkerCommand) => {
  handleCommand(cmd).catch((err: unknown) => {
    emitError(err instanceof Error ? err.message : String(err), false)
  })
})

process.on('uncaughtException', (err: Error) => {
  emitError(err.message, true)
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  emitError(reason instanceof Error ? reason.message : String(reason), false)
})

// Signal to pool that worker is alive and ready for commands
emit({ type: 'HEARTBEAT_ACK', timestamp: Date.now() })
