'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X, RefreshCw, Trash2, Wifi, WifiOff, QrCode } from 'lucide-react'
import Header from '@/components/layout/header'
import Button from '@/components/ui/button'
import Input from '@/components/ui/input'
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
  const { qrModal, setQrModal } = useAccountsStore()
  const [countdown, setCountdown] = useState(120)

  useEffect(() => {
    if (!qrModal?.open) return
    setCountdown(120)
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [qrModal?.accountId, qrModal?.open])

  if (!qrModal?.open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-80 rounded-2xl bg-white p-6 shadow-xl">
        <button
          onClick={() => setQrModal(null)}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">Quét mã QR</h2>
        </div>

        {qrModal.qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrModal.qrDataUrl}
            alt="Zalo QR Code"
            className="mx-auto h-56 w-56 rounded-lg border border-gray-100"
          />
        ) : (
          <div className="flex h-56 w-56 mx-auto items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}

        <p className="mt-4 text-center text-sm text-gray-600">
          Mở <span className="font-medium">Zalo</span> → Quét mã QR
        </p>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
          {countdown > 0 ? (
            <span>Hết hạn sau {countdown}s</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCountdown(120)}
              className="gap-1"
            >
              <RefreshCw className="h-3 w-3" /> Làm mới QR
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const { user } = useAuthStore()
  const { accounts, isLoading, fetchAccounts, addAccount, removeAccount, updateStatus, setQrModal } =
    useAccountsStore()
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [showInput, setShowInput] = useState(false)
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
    socket.on('account:connected', (data: { accountId: string }) => {
      updateStatus({ accountId: data.accountId, status: 'connected' })
      setQrModal(null)
    })

    return () => {
      socket.off('account:status', updateStatus)
      socket.off('qr:update')
      socket.off('account:connected')
    }
  }, [updateStatus, setQrModal])

  useEffect(() => {
    return handleSocketEvents()
  }, [handleSocketEvents])

  const handleAdd = async () => {
    if (!phone.trim()) return
    setAdding(true)
    setAddError('')
    try {
      const account = await addAccount(phone.trim())
      joinAccountRoom(account.id)
      setPhone('')
      setShowInput(false)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Thêm tài khoản thất bại'
      setAddError(Array.isArray(msg) ? msg[0] : msg)
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
          <Button size="sm" onClick={() => setShowInput((v) => !v)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Thêm tài khoản
          </Button>
        </div>

        {showInput && (
          <div className="mb-6 flex items-end gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex-1">
              <Input
                label="Số điện thoại"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0901234567"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                error={addError}
                autoFocus
              />
            </div>
            <Button loading={adding} onClick={handleAdd} size="sm">
              Thêm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowInput(false)
                setAddError('')
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

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
              <AccountCard key={account.id} account={account} onRemove={removeAccount} />
            ))}
          </div>
        )}
      </div>

      <QrModal />
    </div>
  )
}

function AccountCard({
  account,
  onRemove,
}: {
  account: ZaloAccount
  onRemove: (id: string) => Promise<void>
}) {
  const [removing, setRemoving] = useState(false)

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await onRemove(account.id)
    } finally {
      setRemoving(false)
    }
  }

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
            <p className="text-sm font-medium text-gray-900">{account.displayName || account.phone}</p>
            {account.displayName && (
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
        {account.connectedAt && (
          <span className="text-xs text-gray-400">
            {new Date(account.connectedAt).toLocaleDateString('vi-VN')}
          </span>
        )}
      </div>
    </div>
  )
}
