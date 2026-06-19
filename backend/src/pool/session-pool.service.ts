import { Injectable } from '@nestjs/common'
import { fork, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import type Redis from 'ioredis'
import type {
  SessionRecord,
  PoolConfig,
  WorkerCommand,
  WorkerEvent,
} from '../types'
import { DEFAULT_POOL_CONFIG } from '../types'

// When running via ts-node, __filename ends with .ts; use that to detect dev mode
const isDev = __filename.endsWith('.ts')
const WORKER_SCRIPT = resolve(
  __dirname,
  isDev ? '../workers/zalo.worker.ts' : '../workers/zalo.worker.js',
)
const WORKER_EXEC_ARGV = isDev
  ? ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register']
  : []

@Injectable()
export class SessionPoolService {
  private readonly config: PoolConfig
  private readonly processes = new Map<string, ChildProcess>()
  private readonly sessions = new Map<string, SessionRecord>()
  private healthTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly redis: Redis,
    private readonly redisPub: Redis,
    config: Partial<PoolConfig> = {},
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.restoreSessions()
    this.healthTimer = setInterval(
      () => { this.runHealthCheck().catch(() => {}) },
      this.config.heartbeatIntervalMs,
    )
  }

  async stop(): Promise<void> {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null }
    await Promise.allSettled(
      [...this.processes.keys()].map(async (accountId) => {
        this.processes.get(accountId)?.send({ type: 'SHUTDOWN' })
        await new Promise<void>((r) => setTimeout(r, 3000))
        const proc = this.processes.get(accountId)
        if (proc && !proc.killed) proc.kill('SIGKILL')
      }),
    )
    this.processes.clear()
    this.sessions.clear()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async addAccount(params: {
    accountId: string
    phone: string | null
    tenantId: string
    vaultTokenId?: string
  }): Promise<SessionRecord> {
    const { accountId, phone, tenantId, vaultTokenId } = params

    if (this.processes.has(accountId)) throw new Error(`Worker already running for account ${accountId}`)
    if (this.processes.size >= this.config.maxWorkers) throw new Error(`Pool at capacity: max ${this.config.maxWorkers} workers`)

    const workerId = randomUUID()
    const session: SessionRecord = {
      accountId, zaloUserId: '', phone, status: 'initializing',
      workerId, lastHeartbeat: Date.now(), errorCount: 0,
    }

    await this.saveSession(session)
    await this.redis.set(`tenant:${accountId}`, tenantId)

    this.spawnWorker(accountId, workerId, tenantId, vaultTokenId)
    await this.waitWorkerReady(accountId)

    if (vaultTokenId) {
      await this.sendCommand(accountId, { type: 'LOGIN_COOKIE', payload: { cookie: {}, imei: '', userAgent: '' } })
    } else {
      await this.sendCommand(accountId, { type: 'LOGIN_QR' })
    }

    return this.sessions.get(accountId) ?? session
  }

  async removeAccount(accountId: string): Promise<void> {
    const proc = this.processes.get(accountId)
    if (proc) {
      proc.send({ type: 'SHUTDOWN' })
      await new Promise<void>((r) => setTimeout(r, 3000))
      if (!proc.killed) proc.kill('SIGKILL')
    }
    this.processes.delete(accountId)
    await this.deleteSession(accountId)
    await this.redis.del(`tenant:${accountId}`)
  }

  async sendCommand(accountId: string, command: WorkerCommand): Promise<void> {
    const proc = this.processes.get(accountId)
    if (!proc || proc.killed) throw new Error(`No active worker for account ${accountId}`)
    proc.send(command)
  }

  async getActiveSessions(): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
  }

  // ── Fork ──────────────────────────────────────────────────────────────────

  private spawnWorker(
    accountId: string,
    workerId: string,
    tenantId: string,
    vaultTokenId?: string,
  ): ChildProcess {
    const proc = fork(WORKER_SCRIPT, [], {
      execArgv: WORKER_EXEC_ARGV,
      env: {
        ...process.env,
        ACCOUNT_ID: accountId,
        WORKER_ID: workerId,
        TENANT_ID: tenantId,
        VAULT_TOKEN_ID: vaultTokenId ?? '',
        VAULT_INTERNAL_URL: process.env['VAULT_INTERNAL_URL'] ?? 'http://127.0.0.1:3001',
      },
      silent: true,
    })

    proc.on('message', (event: WorkerEvent) => {
      this.handleWorkerEvent(accountId, event).catch(() => {})
    })

    proc.on('exit', (code, signal) => { this.handleWorkerExit(accountId, code, signal) })

    proc.stdout?.on('data', (d: Buffer) => { process.stdout.write(`[W:${accountId.slice(0, 8)}] ${d}`) })
    proc.stderr?.on('data', (d: Buffer) => { process.stderr.write(`[W:${accountId.slice(0, 8)}] ${d}`) })

    this.processes.set(accountId, proc)
    return proc
  }

  // ── Ready wait ────────────────────────────────────────────────────────────

  private waitWorkerReady(accountId: string, timeoutMs?: number): Promise<void> {
    const ms = timeoutMs ?? this.config.spawnTimeoutMs
    return new Promise<void>((res, rej) => {
      const deadline = Date.now() + ms
      const poll = setInterval(() => {
        const session = this.sessions.get(accountId)
        if (!session || session.status !== 'initializing') { clearInterval(poll); res(); return }
        if (Date.now() > deadline) { clearInterval(poll); rej(new Error(`Worker ${accountId} did not become ready within ${ms}ms`)) }
      }, 200)
    })
  }

  // ── Worker event dispatch ─────────────────────────────────────────────────

  private async handleWorkerEvent(accountId: string, event: WorkerEvent): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return

    switch (event.type) {
      case 'HEARTBEAT_ACK':
        session.lastHeartbeat = event.timestamp
        session.errorCount = 0
        if (session.status === 'initializing') session.status = 'disconnected'
        await this.saveSession(session)
        break

      case 'QR_CODE':
        session.status = 'qr_pending'
        await this.saveSession(session)
        await this.redisPub.publish('zalo:status', JSON.stringify({ event: 'QR_CODE', accountId, qrDataUrl: event.payload.qrDataUrl }))
        break

      case 'LOGIN_SUCCESS':
        session.status = 'connected'
        session.zaloUserId = event.payload.userId
        session.connectedAt = Date.now()
        session.metadata = { displayName: event.payload.displayName }
        await this.saveSession(session)
        await this.redisPub.publish('zalo:status', JSON.stringify({ event: 'LOGIN_SUCCESS', accountId, ...event.payload }))
        break

      case 'LOGIN_FAILED':
        session.status = 'error'
        session.errorCount++
        await this.saveSession(session)
        await this.redisPub.publish('zalo:status', JSON.stringify({ event: 'LOGIN_FAILED', accountId, error: event.error }))
        break

      case 'MESSAGE_INCOMING':
        await this.redisPub.publish('zalo:messages', JSON.stringify({ accountId, workerId: session.workerId, message: event.payload }))
        break

      case 'DISCONNECTED':
        session.status = 'disconnected'
        await this.saveSession(session)
        setTimeout(() => { this.reconnect(accountId).catch(() => {}) }, 5_000)
        break

      case 'ERROR':
        session.errorCount++
        if (event.fatal || session.errorCount >= this.config.maxErrorsBeforeKill) {
          session.status = 'error'
          await this.saveSession(session)
          setTimeout(() => { this.restartWorker(accountId).catch(() => {}) }, 10_000)
        } else {
          await this.saveSession(session)
        }
        break
    }
  }

  private handleWorkerExit(accountId: string, code: number | null, signal: NodeJS.Signals | null): void {
    this.processes.delete(accountId)
    const session = this.sessions.get(accountId)
    if (!session || session.status === 'terminated') return
    console.warn(`[pool] Worker ${accountId.slice(0, 8)} exited (code=${code}, signal=${signal}) — scheduling restart`)
    setTimeout(() => { this.restartWorker(accountId).catch(() => {}) }, 5_000)
  }

  // ── Reconnect / Restart ───────────────────────────────────────────────────

  private async reconnect(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session || session.status === 'connected') return

    const storedCreds = await this.redis.get(`creds:${accountId}`)
    if (storedCreds) {
      const creds = JSON.parse(storedCreds) as { cookie: Record<string, unknown>; imei: string; userAgent: string }
      await this.sendCommand(accountId, { type: 'LOGIN_COOKIE', payload: creds })
    } else {
      await this.sendCommand(accountId, { type: 'LOGIN_QR' })
    }
  }

  private async restartWorker(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return

    const proc = this.processes.get(accountId)
    if (proc && !proc.killed) proc.kill('SIGTERM')
    this.processes.delete(accountId)

    const workerId = randomUUID()
    const tenantId = (await this.redis.get(`tenant:${accountId}`)) ?? ''

    await this.saveSession({ ...session, status: 'initializing', errorCount: 0, workerId })
    this.spawnWorker(accountId, workerId, tenantId)
    await this.reconnect(accountId)
  }

  // ── Health check ──────────────────────────────────────────────────────────

  private async runHealthCheck(): Promise<void> {
    for (const [accountId, session] of this.sessions) {
      if (session.status !== 'connected') continue
      const staleness = Date.now() - session.lastHeartbeat
      if (staleness > this.config.heartbeatIntervalMs * 3) {
        console.warn(`[pool] Worker ${accountId.slice(0, 8)} stale (${staleness}ms) — restarting`)
        await this.restartWorker(accountId).catch(() => {})
      } else {
        try { await this.sendCommand(accountId, { type: 'HEARTBEAT' }) } catch { /* process may have exited */ }
      }
    }
  }

  // ── Session persistence ───────────────────────────────────────────────────

  private async saveSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.accountId, session)
    await this.redis.set(`session:${session.accountId}`, JSON.stringify(session), 'EX', 86400)
  }

  private async deleteSession(accountId: string): Promise<void> {
    this.sessions.delete(accountId)
    await this.redis.del(`session:${accountId}`)
  }

  private async restoreSessions(): Promise<void> {
    const keys = await this.redis.keys('session:*')
    for (const key of keys) {
      const raw = await this.redis.get(key)
      if (!raw) continue
      const session: SessionRecord = { ...(JSON.parse(raw) as SessionRecord), status: 'disconnected' }
      this.sessions.set(session.accountId, session)
    }

    for (const [accountId, session] of this.sessions) {
      const tenantId = (await this.redis.get(`tenant:${accountId}`)) ?? ''
      this.spawnWorker(accountId, session.workerId, tenantId)
      this.reconnect(accountId).catch(() => {})
    }
  }
}
