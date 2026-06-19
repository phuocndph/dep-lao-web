import { Injectable } from '@nestjs/common'
import { hkdfSync, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'crypto'
import type { ZaloCreds, StoredCreds, WorkerCredToken } from '../types'

@Injectable()
export class VaultService {
  private readonly masterKey: Buffer
  private readonly pendingTokens = new Map<string, WorkerCredToken>()
  private readonly purgeTimer: ReturnType<typeof setInterval>

  constructor(masterKeyHex: string) {
    const keyBuf = Buffer.from(masterKeyHex, 'hex')
    if (keyBuf.length !== 32) throw new Error('MASTER_KEY must be exactly 32 bytes (64 hex chars)')
    this.masterKey = keyBuf
    this.purgeTimer = setInterval(() => this.purgeExpiredTokens(), 30_000)
    this.purgeTimer.unref()
  }

  private deriveTenantKey(tenantId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.from('deplao-tenant-key-v1'), Buffer.from(tenantId), 32))
  }

  private deriveAccountKey(tenantId: string, accountId: string): Buffer {
    const tenantKey = this.deriveTenantKey(tenantId)
    return Buffer.from(hkdfSync('sha256', tenantKey, Buffer.from('deplao-account-key-v1'), Buffer.from(accountId), 32))
  }

  private purgeExpiredTokens(): void {
    const now = Date.now()
    for (const [tokenId, token] of this.pendingTokens) {
      if (token.expiresAt < now) this.pendingTokens.delete(tokenId)
    }
  }

  encrypt(tenantId: string, accountId: string, creds: ZaloCreds): StoredCreds {
    const key = this.deriveAccountKey(tenantId, accountId)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(JSON.stringify(creds), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const encryptedBlob = Buffer.concat([iv, tag, ct]).toString('hex')
    const now = Date.now()
    return { accountId, tenantId, encryptedBlob, version: 1, createdAt: now, updatedAt: now }
  }

  decrypt(stored: StoredCreds): ZaloCreds {
    if (stored.version !== 1) throw new Error('vault: unsupported blob version')
    if (!stored.accountId || !stored.tenantId) throw new Error('vault: missing ids')

    const key = this.deriveAccountKey(stored.tenantId, stored.accountId)
    const buf = Buffer.from(stored.encryptedBlob, 'hex')
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
      throw new Error('vault: decryption failed')
    }
  }

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
    this.pendingTokens.delete(tokenId)
    return this.decrypt(stored)
  }

  static validateMasterKeyFormat(hex: string): boolean {
    return /^[0-9a-f]{64}$/i.test(hex)
  }
}
