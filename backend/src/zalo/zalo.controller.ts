import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Inject,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import type IoRedis from 'ioredis'
import type { SessionRecord } from '../types'
import { SessionPoolService } from '../pool/session-pool.service'
import { VaultService } from '../vault/vault.service'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CreateAccountDto } from './dto/create-account.dto'
import { SendMessageDto, AddFriendDto } from './dto/send-message.dto'

interface RequestWithUser extends Request {
  user: { userId: string; tenantId: string; role: string }
}

interface AccountListItem {
  id: string
  phone: string | null
  displayName: string | null
  status: string
  connectedAt?: number
  unreadCount: number
}

@Controller('/api')
@UseGuards(JwtAuthGuard)
export class ZaloController {
  constructor(
    private readonly pool: SessionPoolService,
    private readonly vault: VaultService,
    private readonly prisma: PrismaService,
    @Inject('REDIS') private readonly redis: IoRedis,
  ) {}

  @Post('accounts')
  async createAccount(
    @Body() dto: CreateAccountDto,
    @Req() req: RequestWithUser,
  ): Promise<AccountListItem> {
    try {
      const { tenantId } = req.user
      const account = await this.prisma.zaloAccount.create({
        data: { tenantId, zaloUid: '', phone: dto.phone ?? null, displayName: dto.displayName ?? null, status: 'INACTIVE' },
      })

      await this.pool.addAccount({ accountId: account.id, phone: dto.phone ?? null, tenantId })
      return { id: account.id, phone: account.phone, displayName: account.displayName, status: 'qr_pending', unreadCount: 0 }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Get('accounts')
  async listAccounts(@Req() req: RequestWithUser): Promise<AccountListItem[]> {
    try {
      const { tenantId } = req.user
      const [sessions, dbAccounts] = await Promise.all([
        this.pool.getActiveSessions(),
        this.prisma.zaloAccount.findMany({ where: { tenantId } }),
      ])

      const sessionMap = new Map<string, SessionRecord>(sessions.map((s) => [s.accountId, s]))

      return dbAccounts.map((acc) => {
        const session = sessionMap.get(acc.id)
        return {
          id: acc.id,
          phone: acc.phone,
          displayName: acc.displayName,
          status: session?.status ?? acc.status.toLowerCase(),
          connectedAt: session?.connectedAt,
          unreadCount: 0,
        }
      })
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Delete('accounts/:accountId')
  async removeAccount(
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ removed: boolean }> {
    try {
      await this.assertAccountBelongsToTenant(accountId, req.user.tenantId)
      await this.pool.removeAccount(accountId)
      await this.prisma.zaloAccount.update({ where: { id: accountId }, data: { status: 'INACTIVE' } })
      return { removed: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Get('accounts/:accountId/status')
  async getAccountStatus(
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
  ): Promise<SessionRecord | { accountId: string; status: string }> {
    try {
      await this.assertAccountBelongsToTenant(accountId, req.user.tenantId)
      const sessions = await this.pool.getActiveSessions()
      return sessions.find((s) => s.accountId === accountId) ?? { accountId, status: 'disconnected' }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Post('accounts/:accountId/send')
  async sendMessage(
    @Param('accountId') accountId: string,
    @Body() dto: SendMessageDto,
    @Req() req: RequestWithUser,
  ): Promise<{ sent: boolean }> {
    try {
      await this.assertAccountBelongsToTenant(accountId, req.user.tenantId)
      await this.checkRateLimit(`rate:${accountId}:send`, 20, 60, 'Rate limit exceeded: 20 msg/phút')
      await this.pool.sendCommand(accountId, {
        type: 'SEND_MESSAGE',
        payload: { threadId: dto.threadId, threadType: dto.threadType, content: dto.content },
      })
      return { sent: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Post('accounts/:accountId/add-friend')
  async addFriend(
    @Param('accountId') accountId: string,
    @Body() dto: AddFriendDto,
    @Req() req: RequestWithUser,
  ): Promise<{ sent: boolean }> {
    try {
      await this.assertAccountBelongsToTenant(accountId, req.user.tenantId)
      await this.checkRateLimit(`rate:${accountId}:friend`, 15, 86400, 'Rate limit: 15 kết bạn/ngày')
      await this.pool.sendCommand(accountId, { type: 'ADD_FRIEND', payload: { userId: dto.userId, message: dto.message } })
      return { sent: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async assertAccountBelongsToTenant(accountId: string, tenantId: string): Promise<void> {
    const account = await this.prisma.zaloAccount.findFirst({ where: { id: accountId, tenantId } })
    if (!account) throw new HttpException('Account not found', HttpStatus.NOT_FOUND)
  }

  private async checkRateLimit(key: string, limit: number, ttlSeconds: number, message: string): Promise<void> {
    const current = await this.redis.incr(key)
    if (current === 1) await this.redis.expire(key, ttlSeconds)
    if (current > limit) throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS)
  }

  private mapError(err: unknown): HttpException {
    if (err instanceof HttpException) return err
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('No active worker')) return new HttpException('Account worker not found', HttpStatus.NOT_FOUND)
    if (msg.includes('Record to update not found') || msg.includes('not found')) return new HttpException('Account not found', HttpStatus.NOT_FOUND)
    return new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR)
  }
}
