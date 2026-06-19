import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deplao Web',
  description: 'Zalo multi-account management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="h-full">
      <body className="h-full bg-gray-50 antialiased">{children}</body>
    </html>
  )
}
