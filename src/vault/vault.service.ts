import { Injectable } from '@nestjs/common'
import {
  hkdfSync,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from 'crypto'
import type { ZaloCreds, StoredCreds, WorkerCredToken } from '../types/index.js'

@Injectable()
export class VaultService {
  private readonly masterKey: Buffer
  private readonly pendingTokens = new Map<string, WorkerCredToken>()
  private readonly purgeTimer: ReturnType<typeof setInterval>

  constructor(masterKeyHex: string) {
    const keyBuf = Buffer.from(masterKeyHex, 'hex')
    if (keyBuf.length !== 32) {
      throw new Error('MASTER_KEY must be exactly 32 bytes (64 hex chars)')
    }
    this.masterKey = keyBuf
    this.purgeTimer = setInterval(() => this.purgeExpiredTokens(), 30_000)
    // Don't keep the event loop alive in tests
    this.purgeTimer.unref()
  }

  // ── Key derivation ────────────────────────────────────────────────────────

  private deriveTenantKey(tenantId: string): Buffer {
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.masterKey,
        Buffer.from('deplao-tenant-key-v1'),
        Buffer.from(tenantId),
        32,
      ),
    )
  }

  private deriveAccountKey(tenantId: string, accountId: string): Buffer {
    const tenantKey = this.deriveTenantKey(tenantId)
    return Buffer.from(
      hkdfSync(
        'sha256',
        tenantKey,
        Buffer.from('deplao-account-key-v1'),
        Buffer.from(accountId),
        32,
      ),
    )
  }

  // ── Token cleanup ─────────────────────────────────────────────────────────

  private purgeExpiredTokens(): void {
    const now = Date.now()
    for (const [tokenId, token] of this.pendingTokens) {
      if (token.expiresAt < now) this.pendingTokens.delete(tokenId)
    }
  }

  // ── Encrypt ───────────────────────────────────────────────────────────────

  encrypt(tenantId: string, accountId: string, creds: ZaloCreds): StoredCreds {
    const key = this.deriveAccountKey(tenantId, accountId)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(creds), 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag() // always 16 bytes
    const encryptedBlob = Buffer.concat([iv, tag, ct]).toString('hex')
    const now = Date.now()
    return { accountId, tenantId, encryptedBlob, version: 1, createdAt: now, updatedAt: now }
  }

  // ── Decrypt ───────────────────────────────────────────────────────────────

  decrypt(stored: StoredCreds): ZaloCreds {
    if (stored.version !== 1) throw new Error('vault: unsupported blob version')
    if (!stored.accountId || !stored.tenantId) throw new Error('vault: missing ids')

    const key = this.deriveAccountKey(stored.tenantId, stored.accountId)
    const buf = Buffer.from(stored.encryptedBlob, 'hex')

    // iv(12) + tag(16) + ciphertext(≥1)
    if (buf.length <= 28) throw new Error('vault: blob too short')

    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
      return JSON.parse(plain) as ZaloCreds
    } catch {
      // Never leak internal error details — auth tag mismatch or parse failure
      throw new Error('vault: decryption failed')
    }
  }

  // ── Worker tokens ─────────────────────────────────────────────────────────

  issueWorkerToken(tenantId: string, accountId: string): WorkerCredToken {
    const token: WorkerCredToken = {
      tokenId: randomUUID(),
      accountId,
      tenantId,
      expiresAt: Date.now() + 60_000,
    }
    this.pendingTokens.set(token.tokenId, token)
    return token
  }

  consumeWorkerToken(tokenId: string, stored: StoredCreds): ZaloCreds {
    const token = this.pendingTokens.get(tokenId)
    if (!token) throw new Error('vault: token not found or already used')
    if (token.expiresAt < Date.now()) {
      this.pendingTokens.delete(tokenId)
      throw new Error('vault: token expired')
    }
    if (token.accountId !== stored.accountId) throw new Error('vault: token/account mismatch')

    // Delete BEFORE decrypt — one-time use even if decrypt throws
    this.pendingTokens.delete(tokenId)
    return this.decrypt(stored)
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  static validateMasterKeyFormat(hex: string): boolean {
    return /^[0-9a-f]{64}$/i.test(hex)
  }
}
