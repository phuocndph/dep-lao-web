import { io, Socket } from 'socket.io-client'
import { getAccessToken } from './auth'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(
      (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/zalo',
      {
        auth: { token: getAccessToken() },
        autoConnect: false,
        transports: ['websocket', 'polling'],
      },
    )
  }
  return socket
}

export function connectSocket(): void {
  const s = getSocket()
  if (!s.connected) s.connect()
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}

export function joinAccountRoom(accountId: string): void {
  getSocket().emit('join_account_room', accountId)
}

export function leaveAccountRoom(accountId: string): void {
  getSocket().emit('leave_account_room', accountId)
}
