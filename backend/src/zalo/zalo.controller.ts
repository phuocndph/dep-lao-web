import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Put,
  Body,
  Param,
  Query,
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
      await this.prisma.zaloAccount.delete({ where: { id: accountId } })
      await this.redis.del(`creds:${accountId}`)
      await this.redis.del(`rate:${accountId}:send`)
      await this.redis.del(`rate:${accountId}:friend`)
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

  // ── Message endpoints ─────────────────────────────────────────────────────────

  @Get('messages/threads')
  async listThreads(@Req() req: RequestWithUser) {
    try {
      const { tenantId } = req.user
      const msgs = await this.prisma.message.findMany({
        where: { tenantId },
        orderBy: { sentAt: 'desc' },
        take: 500,
        select: { threadId: true, threadType: true, accountId: true, content: true, sentAt: true, direction: true, isRead: true },
      })

      const threadMap = new Map<string, { lastMessage: typeof msgs[0]; unreadCount: number; accountId: string }>()
      for (const msg of msgs) {
        if (!threadMap.has(msg.threadId)) {
          threadMap.set(msg.threadId, { lastMessage: msg, unreadCount: 0, accountId: msg.accountId })
        }
        if (!msg.isRead && msg.direction === 'INBOUND') {
          threadMap.get(msg.threadId)!.unreadCount++
        }
      }

      const result = Array.from(threadMap.entries()).map(([threadId, data]) => ({
        threadId,
        threadType: data.lastMessage.threadType,
        accountId: data.accountId,
        lastMessage: data.lastMessage,
        unreadCount: data.unreadCount,
      }))
      result.sort((a, b) => b.lastMessage.sentAt.getTime() - a.lastMessage.sentAt.getTime())
      return result
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Get('messages/:threadId')
  async listMessages(
    @Param('threadId') threadId: string,
    @Query('limit') limitStr: string | undefined,
    @Query('before') before: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    try {
      const { tenantId } = req.user
      const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200)
      const msgs = await this.prisma.message.findMany({
        where: {
          tenantId,
          threadId,
          ...(before ? { sentAt: { lt: new Date(before) } } : {}),
        },
        orderBy: { sentAt: 'asc' },
        take: limit,
      })
      return msgs
    } catch (err) {
      throw this.mapError(err)
    }
  }

  // ── Draft endpoints ───────────────────────────────────────────────────────────

  @Get('drafts')
  async getDraft(
    @Query('accountId') accountId: string,
    @Query('threadId') threadId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ content: string; updatedAt: Date } | null> {
    try {
      if (!accountId || !threadId) return null
      await this.assertAccountBelongsToTenant(accountId, req.user.tenantId)
      const draft = await this.prisma.draft.findUnique({
        where: { accountId_threadId: { accountId, threadId } },
        select: { content: true, updatedAt: true },
      })
      return draft
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Put('drafts')
  async upsertDraft(
    @Body() body: { accountId: string; threadId: string; content: string },
    @Req() req: RequestWithUser,
  ): Promise<{ success: boolean }> {
    try {
      await this.assertAccountBelongsToTenant(body.accountId, req.user.tenantId)
      await this.prisma.draft.upsert({
        where: { accountId_threadId: { accountId: body.accountId, threadId: body.threadId } },
        update: { content: body.content },
        create: {
          tenantId: req.user.tenantId,
          accountId: body.accountId,
          threadId: body.threadId,
          content: body.content,
        },
      })
      return { success: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Delete('drafts')
  async deleteDraft(
    @Query('accountId') accountId: string,
    @Query('threadId') threadId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ success: boolean }> {
    try {
      if (!accountId || !threadId) return { success: true }
      await this.prisma.draft.deleteMany({
        where: { accountId, threadId, tenantId: req.user.tenantId },
      })
      return { success: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  // ── Quick Message endpoints ───────────────────────────────────────────────────

  @Get('quick-messages')
  async listQuickMessages(@Req() req: RequestWithUser) {
    try {
      return this.prisma.quickMessage.findMany({
        where: { tenantId: req.user.tenantId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Post('quick-messages')
  async createQuickMessage(
    @Body() body: { keyword: string; title: string; content?: string; mediaUrl?: string },
    @Req() req: RequestWithUser,
  ) {
    try {
      return this.prisma.quickMessage.create({
        data: {
          tenantId: req.user.tenantId,
          keyword: body.keyword,
          title: body.title,
          content: body.content ?? null,
          mediaUrl: body.mediaUrl ?? null,
        },
      })
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Put('quick-messages/:qmId')
  async updateQuickMessage(
    @Param('qmId') id: string,
    @Body() body: { keyword?: string; title?: string; content?: string; mediaUrl?: string },
    @Req() req: RequestWithUser,
  ) {
    try {
      const msg = await this.prisma.quickMessage.findFirst({ where: { id, tenantId: req.user.tenantId } })
      if (!msg) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
      return this.prisma.quickMessage.update({ where: { id }, data: body })
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Delete('quick-messages/:qmId')
  async deleteQuickMessage(
    @Param('qmId') id: string,
    @Req() req: RequestWithUser,
  ): Promise<{ removed: boolean }> {
    try {
      const msg = await this.prisma.quickMessage.findFirst({ where: { id, tenantId: req.user.tenantId } })
      if (!msg) throw new HttpException('Not found', HttpStatus.NOT_FOUND)
      await this.prisma.quickMessage.delete({ where: { id } })
      return { removed: true }
    } catch (err) {
      throw this.mapError(err)
    }
  }

  @Patch('messages/:threadId/read')
  async markThreadRead(
    @Param('threadId') threadId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ updated: boolean }> {
    try {
      const { tenantId } = req.user
      await this.prisma.message.updateMany({
        where: { tenantId, threadId, isRead: false, direction: 'INBOUND' },
        data: { isRead: true },
      })
      return { updated: true }
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
