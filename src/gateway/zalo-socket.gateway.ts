import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import Redis from 'ioredis'
import { SessionPoolService } from '../pool/session-pool.service.js'

@WebSocketGateway({
  namespace: '/zalo',
  cors: {
    origin: process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class ZaloSocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server

  private redisSub!: Redis

  constructor(private readonly sessionPool: SessionPoolService) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  afterInit(): void {
    this.redisSub = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')

    this.redisSub.subscribe('zalo:messages', 'zalo:status').catch(console.error)

    this.redisSub.on('message', (channel: string, raw: string) => {
      try {
        const data = JSON.parse(raw) as Record<string, unknown>
        const accountId = data['accountId'] as string

        if (channel === 'zalo:messages') {
          this.server.to(`account:${accountId}`).emit('message:new', data)
        }

        if (channel === 'zalo:status') {
          this.server.to(`account:${accountId}`).emit('account:status', data)

          if (data['event'] === 'QR_CODE') {
            this.server.to(`account:${accountId}`).emit('qr:update', {
              accountId,
              qrDataUrl: data['qrDataUrl'],
            })
          }

          if (data['event'] === 'LOGIN_SUCCESS') {
            this.server.to(`account:${accountId}`).emit('account:connected', {
              accountId,
              displayName: data['displayName'],
            })
          }
        }
      } catch {
        // malformed JSON — bỏ qua
      }
    })
  }

  handleConnection(socket: Socket): void {
    const token = socket.handshake.auth?.['token'] as string | undefined
    if (!token) {
      socket.disconnect(true)
      return
    }

    // Phase 5 sẽ verify JWT thật — hiện dùng token như userId
    socket.data['userId'] = token
    socket.emit('server:ready', { socketId: socket.id })
    console.log(`[WS] Client connected: ${socket.id}`)
  }

  handleDisconnect(socket: Socket): void {
    console.log(`[WS] Client disconnected: ${socket.id}`)
  }

  // ── Message handlers ──────────────────────────────────────────────────────────

  @SubscribeMessage('join_account_room')
  handleJoinRoom(socket: Socket, accountId: string): { joined: boolean } {
    socket.join(`account:${accountId}`)
    socket.emit('room:joined', { accountId })
    return { joined: true }
  }

  @SubscribeMessage('leave_account_room')
  handleLeaveRoom(socket: Socket, accountId: string): { left: boolean } {
    socket.leave(`account:${accountId}`)
    return { left: true }
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    socket: Socket,
    payload: {
      accountId: string
      threadId: string
      threadType: 'user' | 'group'
      content: string
    },
  ): Promise<void> {
    try {
      await this.sessionPool.sendCommand(payload.accountId, {
        type: 'SEND_MESSAGE',
        payload: {
          threadId: payload.threadId,
          threadType: payload.threadType,
          content: payload.content,
        },
      })
      socket.emit('message:sent', { threadId: payload.threadId, ts: Date.now() })
    } catch (err) {
      socket.emit('message:error', {
        error: err instanceof Error ? err.message : String(err),
        threadId: payload.threadId,
      })
    }
  }

  @SubscribeMessage('ping')
  handlePing(): { pong: number } {
    return { pong: Date.now() }
  }
}
