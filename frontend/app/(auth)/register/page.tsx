'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import Input from '@/components/ui/input'
import Button from '@/components/ui/button'

export default function RegisterPage() {
  const router = useRouter()
  const { register, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [error, setError] = useState('')

  const handleTenantNameChange = (val: string) => {
    setTenantName(val)
    setTenantSlug(val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register({ email, password, displayName, tenantName, tenantSlug })
      router.push('/inbox')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Đăng ký thất bại'
      setError(Array.isArray(msg) ? msg[0] : msg)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl bg-white p-8 shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-blue-600">Deplao Web</h1>
          <p className="mt-1 text-sm text-gray-500">Tạo tài khoản mới</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Họ tên"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="Nguyễn Văn A"
            autoFocus
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />
          <Input
            label="Mật khẩu"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            minLength={8}
          />
          <Input
            label="Tên workspace"
            value={tenantName}
            onChange={(e) => handleTenantNameChange(e.target.value)}
            required
            placeholder="Công ty TNHH ABC"
          />
          <Input
            label="Workspace slug"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            required
            placeholder="cong-ty-abc"
          />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <Button type="submit" loading={isLoading} className="w-full mt-2">
            Đăng ký
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Đã có tài khoản?{' '}
          <Link href="/login" className="font-medium text-blue-600 hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  )
}
