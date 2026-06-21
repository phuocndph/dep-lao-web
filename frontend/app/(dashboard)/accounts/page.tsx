'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, RefreshCw, Trash2, Wifi, WifiOff, QrCode, RotateCcw } from 'lucide-react'
import Header from '@/components/layout/header'
import Button from '@/components/ui/button'
import Badge from '@/components/ui/badge'
import Spinner from '@/components/ui/spinner'
import { useAccountsStore, ZaloAccount } from '@/stores/accounts.store'
import { useAuthStore } from '@/stores/auth.store'
import { getSocket, connectSocket, joinAccountRoom } from '@/lib/socket-client'

const STATUS_LABEL: Record<ZaloAccount['status'], string> = {
  connected: 'Đã kết nối',
  qr_pending: 'Chờ quét QR',
  cookie_pending: 'Đang kết nối',
  error: 'Lỗi',
  inactive: 'Không hoạt động',
}

const STATUS_BADGE: Record<ZaloAccount['status'], 'green' | 'yellow' | 'blue' | 'red' | 'gray'> = {
  connected: 'green',
  qr_pending: 'yellow',
  cookie_pending: 'blue',
  error: 'red',
  inactive: 'gray',
}

function QrModal() {
  const { qrModal, setQrModal, removeAccount, addAccount } = useAccountsStore()
  const [countdown, setCountdown] = useState(120)
  const [refreshing, setRefreshing] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!qrModal?.open) return
    setCountdown(120)
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [qrModal?.accountId, qrModal?.open])

  if (!qrModal?.open) return null

  const handleCancel = async () => {
    const accountId = qrModal.accountId
    setCancelling(true)
    setQrModal(null)
    try {
      await removeAccount(accountId)
    } finally {
      setCancelling(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    const oldAccountId = qrModal.accountId
    try {
      await removeAccount(oldAccountId)
      const account = await addAccount()
      joinAccountRoom(account.id)
      setQrModal({ open: true, accountId: account.id, qrDataUrl: '' })
      setCountdown(120)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-80 rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">Quét mã QR bằng Zalo</h2>
        </div>

        {qrModal.qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              qrModal.qrDataUrl.startsWith('data:')
                ? qrModal.qrDataUrl
                : `data:image/png;base64,${qrModal.qrDataUrl}`
            }
            alt="Zalo QR Code"
            width={240}
            height={240}
            className="mx-auto h-60 w-60 rounded-lg border border-gray-100"
          />
        ) : (
          <div className="flex h-60 w-60 mx-auto flex-col items-center justify-center gap-3">
            <Spinner size="lg" />
            <p className="text-xs text-gray-400">Đang tạo mã QR...</p>
          </div>
        )}

        <p className="mt-4 text-center text-sm text-gray-600">
          Mở <span className="font-medium">Zalo</span> → Quét mã → Đăng nhập
        </p>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
          {countdown > 0 ? (
            <span>Hết hạn sau {countdown}s</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={refreshing}
              onClick={handleRefresh}
              className="gap-1"
            >
              <RefreshCw className="h-3 w-3" /> Làm mới
            </Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          loading={cancelling}
          className="mt-3 w-full text-gray-500"
          onClick={handleCancel}
        >
          Hủy
        </Button>
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const { user } = useAuthStore()
  const { accounts, isLoading, fetchAccounts, addAccount, reconnectAccount, removeAccount, updateStatus, updateAccountInfo, setQrModal } =
    useAccountsStore()
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    if (user?.tenantId) fetchAccounts(user.tenantId)
  }, [user?.tenantId, fetchAccounts])

  const handleSocketEvents = useCallback(() => {
    connectSocket()
    const socket = getSocket()

    socket.on('account:status', updateStatus)
    socket.on('qr:update', (data: { accountId: string; qrDataUrl: string }) => {
      setQrModal({ open: true, accountId: data.accountId, qrDataUrl: data.qrDataUrl })
    })
    socket.on('account:connected', (data: { accountId: string; displayName?: string; phone?: string | null }) => {
      updateAccountInfo({ accountId: data.accountId, status: 'connected', displayName: data.displayName ?? null, phone: data.phone ?? null })
      setQrModal(null)
    })

    return () => {
      socket.off('account:status', updateStatus)
      socket.off('qr:update')
      socket.off('account:connected')
    }
  }, [updateStatus, updateAccountInfo, setQrModal])

  useEffect(() => {
    return handleSocketEvents()
  }, [handleSocketEvents])

  const handleAdd = async () => {
    setAdding(true)
    setAddError('')
    try {
      const account = await addAccount()
      if (!account?.id) throw new Error('Server không trả về account id')
      joinAccountRoom(account.id)
      setQrModal({ open: true, accountId: account.id, qrDataUrl: '' })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Không thể thêm tài khoản')
      setAddError(Array.isArray(msg) ? msg[0] : String(msg))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Tài khoản Zalo" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">{accounts.length} tài khoản</p>
          <div className="flex items-center gap-3">
            {addError && (
              <p className="text-xs text-red-500 max-w-xs text-right">{addError}</p>
            )}
            <Button size="sm" loading={adding} onClick={handleAdd} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Thêm tài khoản
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
            <WifiOff className="h-12 w-12" />
            <p className="text-sm">Chưa có tài khoản nào</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onRemove={removeAccount}
                onReconnect={async (id) => {
                  await reconnectAccount(id)
                  joinAccountRoom(id)
                  setQrModal({ open: true, accountId: id, qrDataUrl: '' })
                }}
              />
            ))}
          </div>
        )}
      </div>

      <QrModal />
    </div>
  )
}

const RECONNECTABLE: ZaloAccount['status'][] = ['inactive', 'error']

function AccountCard({
  account,
  onRemove,
  onReconnect,
}: {
  account: ZaloAccount
  onRemove: (id: string) => Promise<void>
  onReconnect: (id: string) => Promise<void>
}) {
  const [removing, setRemoving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await onRemove(account.id)
    } finally {
      setRemoving(false)
    }
  }

  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      await onReconnect(account.id)
    } finally {
      setReconnecting(false)
    }
  }

  const label = account.displayName || account.phone || 'Chưa kết nối'
  const canReconnect = RECONNECTABLE.includes(account.status)

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {account.status === 'connected' ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-gray-400" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">{label}</p>
            {account.displayName && account.phone && (
              <p className="text-xs text-gray-500">{account.phone}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" loading={removing} onClick={handleRemove}>
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Badge variant={STATUS_BADGE[account.status]}>{STATUS_LABEL[account.status]}</Badge>
        <div className="flex items-center gap-2">
          {canReconnect && (
            <Button size="sm" loading={reconnecting} onClick={handleReconnect} className="gap-1 text-xs px-2 py-1 h-auto">
              <RotateCcw className="h-3 w-3" />
              Kết nối lại
            </Button>
          )}
          {account.connectedAt && !canReconnect && (
            <span className="text-xs text-gray-400">
              {new Date(account.connectedAt).toLocaleDateString('vi-VN')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
