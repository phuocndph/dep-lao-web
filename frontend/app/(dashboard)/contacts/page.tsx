'use client'

import { Contact } from 'lucide-react'
import Header from '@/components/layout/header'

export default function ContactsPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Danh bạ" />
      <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-3">
        <Contact className="h-12 w-12" />
        <p className="text-sm">Tính năng đang phát triển</p>
      </div>
    </div>
  )
}
