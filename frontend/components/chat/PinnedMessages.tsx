'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import ipc from '@/lib/ipc'

export interface PinnedMsg {
  id?: string
  msg_id: string
  msg_type: string
  content: string
  preview_text: string
  preview_image: string
  sender_id: string
  sender_name: string
  timestamp: number
  pinned_at: number
}

interface Props {
  zaloId: string
  threadId: string
  pins: PinnedMsg[]
  onPinsChange: (pins: PinnedMsg[]) => void
  onScrollToMsg: (msgId: string) => void
}

export default function PinnedBar({ zaloId, threadId, pins, onPinsChange, onScrollToMsg }: Props) {
  const [showList, setShowList] = useState(false)

  if (pins.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 z-20 flex-shrink-0 min-h-[44px]">
        <div className="w-0.5 self-stretch rounded-full flex-shrink-0 bg-blue-500" />
        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-blue-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>

        <button className="flex-1 min-w-0 text-left" onClick={() => onScrollToMsg(pins[0].msg_id)}>
          <p className="text-[11px] font-semibold text-blue-400 leading-tight">Tin nhắn đã ghim</p>
          <p className="text-xs text-gray-300 truncate leading-tight mt-0.5">
            {pins[0].sender_name ? <span className="text-gray-400">{pins[0].sender_name}: </span> : null}
            {renderPreviewLabel(pins[0])}
          </p>
        </button>

        <div className="flex items-center gap-1 flex-shrink-0">
          {pins.length > 1 && (
            <button onClick={() => setShowList(true)}
              className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 transition-colors">
              +{pins.length - 1}
            </button>
          )}
          <PinItemMenu
            pin={pins[0]}
            onUnpin={async () => {
              await ipc.db.unpinMessage({ zaloId, threadId, msgId: pins[0].msg_id })
              onPinsChange(pins.filter(p => p.msg_id !== pins[0].msg_id))
            }}
            onCopy={() => copyPinText(pins[0])}
          />
        </div>
      </div>

      {showList && (
        <PinnedListModal
          pins={pins}
          zaloId={zaloId}
          threadId={threadId}
          onClose={() => setShowList(false)}
          onScrollToMsg={(id) => { onScrollToMsg(id); setShowList(false) }}
          onPinsChange={onPinsChange}
        />
      )}
    </>
  )
}

function PinnedListModal({ pins, zaloId, threadId, onClose, onScrollToMsg, onPinsChange }: {
  pins: PinnedMsg[]; zaloId: string; threadId: string
  onClose: () => void; onScrollToMsg: (id: string) => void; onPinsChange: (pins: PinnedMsg[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleUnpin = async (msgId: string) => {
    await ipc.db.unpinMessage({ zaloId, threadId, msgId })
    onPinsChange(pins.filter(p => p.msg_id !== msgId))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40 backdrop-blur-sm">
      <div ref={ref} className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <span className="font-semibold text-white">Danh sách ghim ({pins.length})</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {pins.map((pin, idx) => (
            <div key={pin.msg_id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-blue-500/15 rounded-xl overflow-hidden">
                {pin.preview_image ? (
                  <img src={pin.preview_image} alt="" className="w-9 h-9 object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                  </svg>
                )}
              </div>
              <button className="flex-1 min-w-0 text-left py-0.5" onClick={() => { onScrollToMsg(pin.msg_id); onClose() }}>
                <p className="text-sm font-semibold text-gray-100">Tin nhắn</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">
                  {pin.sender_name ? <span className="text-gray-500">{pin.sender_name}: </span> : null}
                  {renderPreviewLabel(pin)}
                </p>
              </button>
              <PinItemMenu
                pin={pin}
                onUnpin={() => handleUnpin(pin.msg_id)}
                onCopy={() => copyPinText(pin)}
                onBringToTop={idx > 0 ? async () => {
                  await ipc.db.bringPinnedToTop({ zaloId, threadId, msgId: pin.msg_id })
                  const updated = [{ ...pin, pinned_at: Date.now() }, ...pins.filter(p => p.msg_id !== pin.msg_id)]
                  onPinsChange(updated)
                } : undefined}
                useFixed
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PinItemMenu({ pin, onUnpin, onCopy, onBringToTop, useFixed }: {
  pin: PinnedMsg; onUnpin: () => void; onCopy: () => void; onBringToTop?: () => void; useFixed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (useFixed && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownH = 120
      if (spaceBelow < dropdownH) {
        setPos({ top: rect.top - dropdownH - 4, left: rect.right - 160 })
      } else {
        setPos({ top: rect.bottom + 4, left: rect.right - 160 })
      }
    }
    setOpen(v => !v)
  }

  const hasText = !!(pin.preview_text?.trim())

  return (
    <div className="relative flex-shrink-0">
      <button ref={btnRef} onClick={handleOpen}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-600 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
        </svg>
      </button>
      {open && (
        useFixed && pos ? (
          <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
            className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-40 py-1">
            {hasText && <DropItem label="Copy" onClick={() => { onCopy(); setOpen(false) }} />}
            {onBringToTop && <DropItem label="Đưa lên đầu" onClick={() => { onBringToTop(); setOpen(false) }} />}
            <DropItem label="Bỏ ghim" onClick={() => { onUnpin(); setOpen(false) }} danger />
          </div>
        ) : (
          <div ref={menuRef} className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl z-50 w-40 py-1">
            {hasText && <DropItem label="Copy" onClick={() => { onCopy(); setOpen(false) }} />}
            {onBringToTop && <DropItem label="Đưa lên đầu" onClick={() => { onBringToTop(); setOpen(false) }} />}
            <DropItem label="Bỏ ghim" onClick={() => { onUnpin(); setOpen(false) }} danger />
          </div>
        )
      )}
    </div>
  )
}

function DropItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700 transition-colors ${danger ? 'text-red-400' : 'text-gray-200'}`}>
      {label}
    </button>
  )
}

function renderPreviewLabel(pin: PinnedMsg): string {
  if (pin.preview_text?.trim()) return pin.preview_text.trim()
  if (pin.preview_image) return '[Hình ảnh]'
  const t = pin.msg_type || ''
  if (t === 'photo' || t === 'image') return '[Hình ảnh]'
  if (t.includes('video')) return '[Video]'
  if (t.includes('file') || t === 'share.file') return '[File]'
  if (t === 'sticker') return '[Sticker]'
  if (t === 'audio' || t === 'voice') return '[Âm thanh]'
  return pin.content?.slice(0, 100) || '[Tin nhắn]'
}

function copyPinText(pin: PinnedMsg) {
  const text = pin.preview_text?.trim() || renderPreviewLabel(pin)
  navigator.clipboard.writeText(text).catch(() => {})
}

export function usePinnedData(zaloId: string | null, threadId: string | null) {
  const [pins, setPins] = useState<PinnedMsg[]>([])
  const [ready, setReady] = useState(false)

  const loadAll = useCallback(async () => {
    if (!zaloId || !threadId) { setPins([]); setReady(true); return }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await ipc.db.getPinnedMessages({ zaloId, threadId }) as any
      if (res?.success) setPins((res.pins as PinnedMsg[]) || [])
    } catch {
      setPins([])
    }
    setReady(true)
  }, [zaloId, threadId])

  useEffect(() => { setReady(false); void loadAll() }, [loadAll])

  return { pins, setPins, ready }
}

export function buildPinFromMsg(msg: Record<string, unknown>, senderName: string) {
  const t = String(msg.msg_type || '')
  const rawContent = String(msg.content || '')
  let previewText = ''
  let previewImage = ''

  if (t === 'photo' || t === 'image') {
    previewImage = ''
    previewText = ''
  } else {
    try {
      const p = JSON.parse(rawContent) as Record<string, unknown>
      previewText = String(p.msg || p.title || rawContent).slice(0, 100)
    } catch {
      previewText = rawContent.slice(0, 100)
    }
  }

  return {
    msgId: String(msg.msg_id || ''),
    msgType: t,
    content: rawContent,
    previewText,
    previewImage,
    senderId: String(msg.sender_id || ''),
    senderName,
    timestamp: Number(msg.timestamp) || Date.now(),
  }
}
