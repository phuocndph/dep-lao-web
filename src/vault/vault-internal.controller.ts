import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Inject,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import type Redis from 'ioredis'
import type { StoredCreds } from '../types/index.js'
import { VaultService } from './vault.service.js'

// ── Guards ────────────────────────────────────────────────────────────────────

@Injectable()
class InternalOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>()
    const raw = req.ip ?? req.socket.remoteAddress ?? ''
    // Strip IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 → 127.0.0.1)
    const ip = raw.replace(/^::ffff:/, '')
    const allowed = (process.env['INTERNAL_ALLOWED_IPS'] ?? '127.0.0.1')
      .split(',')
      .map((s) => s.trim())
    if (!allowed.includes(ip)) {
      throw new ForbiddenException('internal endpoint: access denied')
    }
    return true
  }
}

// Placeholder — replaced by real JwtAuthGuard once auth module is wired
@Injectable()
class JwtAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true
  }
}

// ── Internal controller (worker-facing) ───────────────────────────────────────

interface FetchBody {
  tokenId: string
  accountId: string
  tenantId: string
}

@Controller('/internal/vault')
export class VaultInternalController {
  constructor(
    private readonly vault: VaultService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  @Post('fetch')
  @UseGuards(InternalOnlyGuard)
  async fetchCreds(
    @Body() body: FetchBody,
  ): Promise<{ cookie: Record<string, unknown>; imei: string; userAgent: string }> {
    const { tokenId, accountId } = body

    const raw = await this.redis.get(`creds:${accountId}`)
    if (!raw) throw new NotFoundException('vault: credentials not found')

    const stored = JSON.parse(raw) as StoredCreds

    let creds: ReturnType<VaultService['consumeWorkerToken']>
    try {
      creds = this.vault.consumeWorkerToken(tokenId, stored)
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'vault: token error',
      )
    }

    // Return only what the worker needs — never leak capturedAt or other metadata
    return { cookie: creds.cookie, imei: creds.imei, userAgent: creds.userAgent }
  }
}

// ── Public API controller (browser-facing) ────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

interface CredentialStatus {
  hasCredentials: boolean
  needsRelogin: boolean
  capturedAt?: number
}

@Controller('/api/vault')
export class VaultPublicController {
  constructor(
    private readonly vault: VaultService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  @Get('accounts/:accountId/status')
  @UseGuards(JwtAuthGuard)
  async getCredentialStatus(
    @Param('accountId') accountId: string,
  ): Promise<CredentialStatus> {
    const raw = await this.redis.get(`creds:${accountId}`)
    if (!raw) return { hasCredentials: false, needsRelogin: true }

    let stored: StoredCreds
    try {
      stored = JSON.parse(raw) as StoredCreds
    } catch {
      return { hasCredentials: false, needsRelogin: true }
    }

    let capturedAt: number | undefined
    let decryptOk = false
    try {
      const creds = this.vault.decrypt(stored)
      capturedAt = creds.capturedAt
      decryptOk = true
    } catch {
      // decrypt failed — creds corrupt or key changed
    }

    const isStale = capturedAt !== undefined && Date.now() - capturedAt > THIRTY_DAYS_MS
    const needsRelogin = !decryptOk || isStale

    // Return capturedAt only — never return raw creds
    return { hasCredentials: true, needsRelogin, capturedAt }
  }
}
