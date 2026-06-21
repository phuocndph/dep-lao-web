'use client'

import { Component, ReactNode, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { getAccessToken } from '@/lib/auth'
import { connectSocket, getSocket } from '@/lib/socket-client'
import { emitIpcEvent, getQrTempId, deleteQrMapping } from '@/lib/ipc'
import { useAuthStore } from '@/stores/auth.store'

// Install the window.electronAPI stub before App mounts
import '@deplao/lib/electronPolyfill'
// Bring in desktop-app base styles
import '@deplao/index.css'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', background: '#111', color: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#f87171', marginBottom: 12 }}>Lỗi render Deplao UI</h2>
          <pre style={{ color: '#fca5a5', whiteSpace: 'pre-wrap', marginBottom: 16, fontSize: 13 }}>
            {(this.state.error as Error).message}
          </pre>
          <pre style={{ color: '#9ca3af', whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {(this.state.error as Error).stack}
          </pre>
          <p style={{ color: '#6b7280', marginTop: 16, fontSize: 12 }}>Xem DevTools Console để biết thêm chi tiết.</p>
        </div>
      )
    }
    return this.props.children
  }
}

const DeplaoApp = dynamic(
  () => import('@deplao/App'),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <svg className="animate-spin w-10 h-10 text-blue-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-400 text-sm">Đang tải Deplao...</p>
        </div>
      </div>
    ),
  }
)

export default function DeplaoPage() {
  const router = useRouter()
  const { user, fetchMe } = useAuthStore()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetchMe().then((u) => {
      // fetchMe updates the store; check store state via user after re-render
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (user?.role === 'ADMIN') setIsAdmin(true)
  }, [user])

  useEffect(() => {
    // Auth guard: redirect to login if no JWT
    if (!getAccessToken()) {
      window.location.href = '/login'
      return
    }

    // Set up socket → IPC event bridge BEFORE connecting so we don't miss events
    const socket = getSocket()

    // message:new  →  event:message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMessage = (payload: any) => {
      const { accountId, ...message } = payload
      emitIpcEvent('event:message', { zaloId: accountId, message })
    }

    // qr:update  →  ipc qr:update (with tempId lookup)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleQrUpdate = (payload: any) => {
      const tempId = getQrTempId(payload.accountId) ?? payload.accountId
      emitIpcEvent('qr:update', { tempId, status: 'waiting', qrDataUrl: payload.qrDataUrl })
    }

    // account:connected  →  event:connected + qr:update success
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleAccountConnected = (payload: any) => {
      const tempId = getQrTempId(payload.accountId)
      if (tempId) {
        emitIpcEvent('qr:update', { tempId, status: 'success' })
        deleteQrMapping(payload.accountId)
      }
      emitIpcEvent('event:connected', { zaloId: payload.accountId, displayName: payload.displayName })
    }

    // account:status  →  event:connected / event:disconnected
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleAccountStatus = (payload: any) => {
      if (payload.status === 'connected') {
        emitIpcEvent('event:connected', { zaloId: payload.accountId })
      } else if (payload.status === 'disconnected' || payload.status === 'error' || payload.status === 'inactive') {
        emitIpcEvent('event:disconnected', { zaloId: payload.accountId })
      }
    }

    socket.on('message:new', handleMessage)
    socket.on('qr:update', handleQrUpdate)
    socket.on('account:connected', handleAccountConnected)
    socket.on('account:status', handleAccountStatus)

    // Connect after listeners are registered so we don't miss early events
    connectSocket()

    return () => {
      socket.off('message:new', handleMessage)
      socket.off('qr:update', handleQrUpdate)
      socket.off('account:connected', handleAccountConnected)
      socket.off('account:status', handleAccountStatus)
    }
  }, [])

  return (
    <ErrorBoundary>
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
        <DeplaoApp />
        {isAdmin && (
          <button
            onClick={() => router.push('/users')}
            title="Quản lý nhân viên"
            style={{
              position: 'fixed',
              bottom: '16px',
              right: '16px',
              zIndex: 9999,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              fontSize: '18px',
            }}
          >
            👥
          </button>
        )}
      </div>
    </ErrorBoundary>
  )
}
