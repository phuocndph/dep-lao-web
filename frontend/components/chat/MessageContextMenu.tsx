'use client'

import React, { useEffect, useRef } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>

interface MessageContextMenuProps {
  x: number
  y: number
  msg: Msg
  isSent: boolean
  onClose: () => void
  onReply: (msg: Msg) => void
  onUndo: (msg: Msg) => void
  onDelete: (msg: Msg) => void
  onPin?: (msg: Msg) => void
  onReact?: (msg: Msg, reaction: string) => void
  showNotification?: (msg: string, type: 'success' | 'error' | 'info') => void
}

const QUICK_REACTIONS = ['❤️', '😆', '😯', '😢', '😡', '👍']

export default function MessageContextMenu({
  x, y, msg, isSent,
  onClose, onReply, onUndo, onDelete, onPin, onReact, showNotification,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const copyText = () => {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    navigator.clipboard.writeText(text).then(() => showNotification?.('Đã copy', 'success')).catch(() => {})
    onClose()
  }

  // Adjust position so menu doesn't overflow viewport
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(y, window.innerHeight - 320),
    left: Math.min(x, window.innerWidth - 200),
  }

  return (
    <div ref={menuRef} style={menuStyle}
      className="bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl w-48 overflow-hidden py-1">
      {/* Quick reactions */}
      {onReact && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/60">
          {QUICK_REACTIONS.map(r => (
            <button key={r} onClick={() => { onReact(msg, r); onClose() }}
              className="text-lg hover:scale-125 transition-transform">
              {r}
            </button>
          ))}
        </div>
      )}

      <MenuItem label="Trả lời" icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>
        </svg>
      } onClick={() => { onReply(msg); onClose() }} />

      <MenuItem label="Copy" icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      } onClick={copyText} />

      {onPin && (
        <MenuItem label="Ghim tin nhắn" icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        } onClick={() => { onPin(msg); onClose() }} />
      )}

      {isSent && (
        <MenuItem label="Thu hồi" icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/>
          </svg>
        } onClick={() => { onUndo(msg); onClose() }} />
      )}

      <div className="border-t border-gray-700/60 mt-1 pt-1">
        <MenuItem label="Xóa (local)" icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        } onClick={() => { onDelete(msg); onClose() }} danger />
      </div>
    </div>
  )
}

function MenuItem({ label, icon, onClick, danger }: {
  label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-gray-700 ${danger ? 'text-red-400' : 'text-gray-200'}`}>
      <span className="flex-shrink-0 opacity-70">{icon}</span>
      {label}
    </button>
  )
}
