import { fork, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import type Redis from 'ioredis'
import type {
  SessionRecord,
  SessionStatus,
  PoolConfig,
  WorkerCommand,
  WorkerEvent,
} from '../types/index.js'
import { DEFAULT_POOL_CONFIG } from '../types/index.js'

type WorkerEventCallback = (accountId: string, event: WorkerEvent) => void | Promise<void>

interface WorkerEntry {
  process: ChildProcess
  tenantId: string
}

const SESSION_KEY = (accountId: string) => `session:${accountId}`
const POOL_SET_KEY = 'pool:accounts'

export class SessionPoolService {
  private readonly config: PoolConfig
  private readonly redis: Redis
  private readonly workers = new Map<string, WorkerEntry>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private onEvent: WorkerEventCallback | null = null
  private readonly workerPath: string

  constructor(redis: Redis, config: Partial<PoolConfig> = {}, workerPath?: string) {
    this.redis = redis
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
    // Resolved at runtime from compiled output: dist/src/workers/zalo.worker.js
    this.workerPath = workerPath ?? resolve(__dirname, '../workers/zalo.worker.js')
  }

  setEventHandler(handler: WorkerEventCallback): void {
    this.onEvent = handler
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.restoreFromRedis()
    this.startHeartbeat()
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const [accountId] of this.workers) {
      this.send(accountId, { type: 'SHUTDOWN' })
    }
    // Grace period for workers to flush
    await new Promise<void>((r) => setTimeout(r, 2000))
    for (const [, entry] of this.workers) {
      if (!entry.process.killed) entry.process.kill('SIGTERM')
    }
    this.workers.clear()
  }

  // ── Spawn / Kill ──────────────────────────────────────────────────────────

  async spawn(opts: {
    accountId: string
    tenantId: string
    vaultTokenId: string
    mode: 'qr' | 'cookie'
  }): Promise<SessionRecord> {
    const { accountId, tenantId, vaultTokenId, mode } = opts

    if (this.workers.has(accountId)) {
      throw new Error(`Worker already running for account ${accountId}`)
    }
    if (this.workers.size >= this.config.maxWorkers) {
      throw new Error(`Pool at capacity: max ${this.config.maxWorkers} workers`)
    }

    const workerId = randomUUID()
    const record: SessionRecord = {
      accountId,
      zaloUserId: '',
      phone: '',
      status: 'initializing',
      workerId,
      lastHeartbeat: Date.now(),
      errorCount: 0,
    }
    await this.saveSession(record)
    await this.redis.sadd(POOL_SET_KEY, accountId)

    this.forkWorker({ accountId, tenantId, vaultTokenId, workerId, mode })

    return record
  }

  async kill(accountId: string): Promise<void> {
    const entry = this.workers.get(accountId)
    if (entry) {
      this.send(accountId, { type: 'SHUTDOWN' })
      await new Promise<void>((r) => setTimeout(r, 1000))
      if (!entry.process.killed) entry.process.kill('SIGTERM')
      this.workers.delete(accountId)
    }
    await this.patchSession(accountId, { status: 'terminated' })
    await this.redis.srem(POOL_SET_KEY, accountId)
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  send(accountId: string, cmd: WorkerCommand): boolean {
    const entry = this.workers.get(accountId)
    if (!entry || entry.process.killed) return false
    return entry.process.send(cmd) ?? false
  }

  // ── Fork ──────────────────────────────────────────────────────────────────

  private forkWorker(opts: {
    accountId: string
    tenantId: string
    vaultTokenId: string
    workerId: string
    mode: 'qr' | 'cookie'
  }): void {
    const { accountId, tenantId, vaultTokenId, workerId, mode } = opts

    const child = fork(this.workerPath, [], {
      execArgv: [],
      env: {
        ...process.env,
        ACCOUNT_ID: accountId,
        WORKER_ID: workerId,
        TENANT_ID: tenantId,
        VAULT_TOKEN_ID: vaultTokenId,
      },
    })

    this.workers.set(accountId, { process: child, tenantId })

    child.on('message', (msg: WorkerEvent) => {
      this.handleEvent(accountId, msg).catch(() => {})
    })

    child.on('exit', (code, signal) => {
      this.handleExit(accountId, code, signal).catch(() => {})
    })

    child.on('error', (err) => {
      this.handleProcessError(accountId, err).catch(() => {})
    })

    // LOGIN_COOKIE: worker fetches creds from vault using VAULT_TOKEN_ID env var
    const loginCmd: WorkerCommand =
      mode === 'qr'
        ? { type: 'LOGIN_QR' }
        : { type: 'LOGIN_COOKIE', payload: { cookie: {}, imei: '', userAgent: '' } }

    child.send(loginCmd)
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private async handleEvent(accountId: string, event: WorkerEvent): Promise<void> {
    try { await this.onEvent?.(accountId, event) } catch { /* caller's concern */ }

    switch (event.type) {
      case 'LOGIN_SUCCESS':
        await this.patchSession(accountId, {
          status: 'connected',
          zaloUserId: event.payload.userId,
          connectedAt: Date.now(),
          lastHeartbeat: Date.now(),
          errorCount: 0,
          metadata: { displayName: event.payload.displayName },
        })
        break

      case 'LOGIN_FAILED':
        await this.patchSession(accountId, { status: 'error' })
        await this.bumpError(accountId)
        break

      case 'DISCONNECTED':
        await this.patchSession(accountId, { status: 'disconnected' })
        break

      case 'HEARTBEAT_ACK':
        await this.patchSession(accountId, { lastHeartbeat: event.timestamp })
        break

      case 'ERROR': {
        const count = await this.bumpError(accountId)
        if (event.fatal || count >= this.config.maxErrorsBeforeKill) {
          await this.kill(accountId)
        }
        break
      }
    }
  }

  private async handleExit(
    accountId: string,
    _code: number | null,
    _signal: NodeJS.Signals | null,
  ): Promise<void> {
    this.workers.delete(accountId)
    const s = await this.getSession(accountId)
    if (!s || s.status === 'terminated') return
    await this.patchSession(accountId, { status: 'disconnected' })
    await this.redis.srem(POOL_SET_KEY, accountId)
  }

  private async handleProcessError(accountId: string, err: Error): Promise<void> {
    try {
      await this.onEvent?.(accountId, { type: 'ERROR', error: err.message, fatal: false })
    } catch { /* ignore */ }
    await this.bumpError(accountId)
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat().catch(() => {})
    }, this.config.heartbeatIntervalMs)
  }

  private async runHeartbeat(): Promise<void> {
    const staleMs = this.config.heartbeatIntervalMs * 2
    const now = Date.now()

    for (const [accountId] of this.workers) {
      this.send(accountId, { type: 'HEARTBEAT' })
      const s = await this.getSession(accountId)
      if (s && s.status === 'connected' && now - s.lastHeartbeat > staleMs) {
        await this.patchSession(accountId, { status: 'disconnected' })
      }
    }
  }

  // ── Restore on startup ────────────────────────────────────────────────────

  private async restoreFromRedis(): Promise<void> {
    const ids = await this.redis.smembers(POOL_SET_KEY)
    for (const accountId of ids) {
      const s = await this.getSession(accountId)
      if (!s) {
        await this.redis.srem(POOL_SET_KEY, accountId)
        continue
      }
      // Server restarted — any in-flight or connected sessions are now dead
      if (s.status === 'connected' || s.status === 'initializing') {
        await this.patchSession(accountId, { status: 'disconnected' })
      }
    }
  }

  // ── Session store ─────────────────────────────────────────────────────────

  async getSession(accountId: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(SESSION_KEY(accountId))
    return raw ? (JSON.parse(raw) as SessionRecord) : null
  }

  async getAllSessions(): Promise<SessionRecord[]> {
    const ids = await this.redis.smembers(POOL_SET_KEY)
    const rows = await Promise.all(ids.map((id) => this.getSession(id)))
    return rows.filter((s): s is SessionRecord => s !== null)
  }

  private async saveSession(r: SessionRecord): Promise<void> {
    await this.redis.set(SESSION_KEY(r.accountId), JSON.stringify(r))
  }

  private async patchSession(
    accountId: string,
    patch: Partial<SessionRecord>,
  ): Promise<void> {
    const s = await this.getSession(accountId)
    if (!s) return
    await this.saveSession({ ...s, ...patch })
  }

  private async bumpError(accountId: string): Promise<number> {
    const s = await this.getSession(accountId)
    if (!s) return 0
    const errorCount = s.errorCount + 1
    await this.patchSession(accountId, { errorCount })
    return errorCount
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  workerCount(): number {
    return this.workers.size
  }

  isRunning(accountId: string): boolean {
    const entry = this.workers.get(accountId)
    return !!entry && !entry.process.killed
  }
}
