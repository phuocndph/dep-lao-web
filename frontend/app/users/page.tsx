'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { useUsersStore, TenantUser } from '@/stores/users.store'
import Spinner from '@/components/ui/spinner'

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Quản trị',
  MANAGER: 'Quản lý',
  EMPLOYEE: 'Nhân viên',
}

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-gray-100 text-gray-600',
}

function AddUserModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (dto: { email: string; password: string; displayName: string; role: string }) => Promise<void>
}) {
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'EMPLOYEE' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Mật khẩu ít nhất 8 ký tự')
      return
    }
    setLoading(true)
    try {
      await onAdd(form)
      onClose()
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Có lỗi xảy ra'
      setError(msg.includes('409') || msg.toLowerCase().includes('conflict') ? 'Email đã tồn tại trong tenant này' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Thêm nhân viên</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên</label>
            <input
              type="text"
              required
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nguyễn Văn A"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="nhanvien@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ít nhất 8 ký tự"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vai trò</label>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="EMPLOYEE">Nhân viên</option>
              <option value="MANAGER">Quản lý</option>
              <option value="ADMIN">Quản trị</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm hover:bg-gray-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Spinner size="sm" />}
              Thêm nhân viên
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UserRow({ user, onDelete }: { user: TenantUser; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Vô hiệu hóa tài khoản ${user.displayName}?`)) return
    setDeleting(true)
    try {
      await onDelete(user.id)
    } finally {
      setDeleting(false)
    }
  }

  const initials = (user.displayName || user.email).slice(0, 2).toUpperCase()

  return (
    <tr className={`border-b border-gray-100 ${!user.isActive ? 'opacity-50' : ''}`}>
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-800">{user.displayName}</div>
            <div className="text-xs text-gray-500">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[user.role] || 'bg-gray-100 text-gray-600'}`}>
          {ROLE_LABEL[user.role] || user.role}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {user.isActive ? 'Hoạt động' : 'Đã vô hiệu hóa'}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">
        {new Date(user.createdAt).toLocaleDateString('vi-VN')}
      </td>
      <td className="py-3 px-4 text-right">
        {user.isActive && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            {deleting ? 'Đang xử lý...' : 'Vô hiệu hóa'}
          </button>
        )}
      </td>
    </tr>
  )
}

export default function UsersPage() {
  const router = useRouter()
  const { user, fetchMe } = useAuthStore()
  const { users, isLoading, fetchUsers, createUser, deleteUser } = useUsersStore()
  const [showAdd, setShowAdd] = useState(false)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) {
      router.push('/login')
      return
    }
    fetchMe()
      .then(() => setAuthReady(true))
      .catch(() => router.push('/login'))
  }, [])

  useEffect(() => {
    if (!authReady) return
    if (user && user.role !== 'ADMIN') {
      router.push('/deplao')
      return
    }
    if (user?.role === 'ADMIN') {
      fetchUsers()
    }
  }, [authReady, user])

  if (!authReady || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/deplao')}
              className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1"
            >
              ← Quay lại Deplao
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-xl font-semibold text-gray-800">Quản lý nhân viên</h1>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            + Thêm nhân viên
          </button>
        </div>

        {/* Info card */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-sm text-blue-700">
          Nhân viên đăng nhập tại <strong>trang đăng nhập</strong> với email + mật khẩu + workspace slug: <strong>{user.tenantId?.slice(0, 8)}...</strong>
          {' '}Họ sẽ thấy và sử dụng tất cả tài khoản Zalo đã kết nối trong workspace này.
        </div>

        {/* Users table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide py-3 px-4">Tên</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide py-3 px-4">Vai trò</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide py-3 px-4">Trạng thái</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide py-3 px-4">Ngày tạo</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-gray-400">
                      Chưa có nhân viên nào. Nhấn &quot;+ Thêm nhân viên&quot; để bắt đầu.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => <UserRow key={u.id} user={u} onDelete={deleteUser} />)
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAdd && (
        <AddUserModal onClose={() => setShowAdd(false)} onAdd={createUser} />
      )}
    </div>
  )
}
