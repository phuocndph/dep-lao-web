import React from 'react'

interface BulkActionBarProps {
  selectedCount: number
  onClearSelection: () => void
  onBulkTagLabel: () => void
}

// TODO: Add "add to campaign" when campaigns are implemented (Phase 6.2)
export default function BulkActionBar({ selectedCount, onClearSelection, onBulkTagLabel }: BulkActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-gray-600 rounded-2xl px-5 py-2.5 shadow-2xl">
      <span className="text-sm font-semibold text-blue-400 whitespace-nowrap">{selectedCount} đã chọn</span>
      <div className="w-px h-5 bg-gray-600 flex-shrink-0" />

      <button
        onClick={onBulkTagLabel}
        className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        Gán nhãn
      </button>

      <div className="w-px h-5 bg-gray-600 flex-shrink-0" />
      <button onClick={onClearSelection} className="text-gray-400 hover:text-white text-xs px-1 transition-colors" title="Bỏ chọn">
        ✕
      </button>
    </div>
  )
}
