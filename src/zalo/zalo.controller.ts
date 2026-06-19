import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type IoRedis from 'ioredis'
import type { SessionRecord } from '../types/index.js'
import { SessionPoolService } from '../pool/session-pool.service.js'
import { VaultService } from '../vault/vault.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CreateAccountDto } from './dto/create-account.dto.js'
import { SendMessageDto, AddFriendDto } from './dto/send-message.dto.js'

interface AccountListItem {
  id: string
  phone: string | null
  displayName: string | null
  status: string
  connectedAt?: number
  unreadCount: number
}

@Controller('/api')
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
  ): Promise<{ accountId: string; status: string }> {
    try {
      const account = await this.prisma.zaloAccount.create({
        data: {
          tenantId: dto.tenantId,
          zaloUid: '',
          phone: dto.phone,
          displayName: dto.displayName,
          status: 'INACTIVE',
        },
      })

      await this.pool.addAccount({
        accountId: account.id,
        phone: dto.phone,
        tenantId: dto.tenantId,
      })

      return { accountId: account.id, status: 'qr_pending' }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Get('accounts')
  async listAccounts(@Query('tenantId') tenantId: string): Promise<AccountListItem[]> {
    try {
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
  async removeAccount(@Param('accountId') accountId: string): Promise<{ removed: boolean }> {
    try {
      await this.pool.removeAccount(accountId)
      await this.prisma.zaloAccount.update({
        where: { id: accountId },
        data: { status: 'INACTIVE' },
      })
      return { removed: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Get('accounts/:accountId/status')
  async getAccountStatus(
    @Param('accountId') accountId: string,
  ): Promise<SessionRecord | { accountId: string; status: string }> {
    try {
      const sessions = await this.pool.getActiveSessions()
      const session = sessions.find((s) => s.accountId === accountId)
      return session ?? { accountId, status: 'disconnected' }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Post('accounts/:accountId/send')
  async sendMessage(
    @Param('accountId') accountId: string,
    @Body() dto: SendMessageDto,
  ): Promise<{ sent: boolean }> {
    try {
      await this.checkRateLimit(
        `rate:${accountId}:send`,
        20,
        60,
        'Rate limit exceeded: 20 msg/phút',
      )

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
  ): Promise<{ sent: boolean }> {
    try {
      await this.checkRateLimit(
        `rate:${accountId}:friend`,
        15,
        86400,
        'Rate limit: 15 kết bạn/ngày',
      )

      await this.pool.sendCommand(accountId, {
        type: 'ADD_FRIEND',
        payload: { userId: dto.userId, message: dto.message },
      })

      return { sent: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async checkRateLimit(
    key: string,
    limit: number,
    ttlSeconds: number,
    message: string,
  ): Promise<void> {
    const current = await this.redis.incr(key)
    if (current === 1) await this.redis.expire(key, ttlSeconds)
    if (current > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  private mapError(err: unknown): HttpException {
    if (err instanceof HttpException) return err

    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('No active worker')) {
      return new HttpException('Account worker not found', HttpStatus.NOT_FOUND)
    }
    if (
      msg.includes('Record to update not found') ||
      msg.includes('not found') ||
      msg.includes('No ZaloAccount found')
    ) {
      return new HttpException('Account not found', HttpStatus.NOT_FOUND)
    }

    return new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR)
  }
}
