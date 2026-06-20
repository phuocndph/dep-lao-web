'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

export interface MediaViewerImage {
  src: string
  displaySrc?: string
  alt?: string
  defaultName?: string
  msgId?: string
}

interface MediaViewerProps {
  src?: string
  images?: MediaViewerImage[]
  initialIndex?: number
  alt?: string
  onClose: () => void
}

export default function MediaViewer({ src, images, initialIndex = 0, alt = 'ảnh', onClose }: MediaViewerProps) {
  const imageList: MediaViewerImage[] = React.useMemo(() => {
    if (images && images.length > 0) return images
    if (src) return [{ src, alt }]
    return []
  }, [images, src, alt])

  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, imageList.length - 1))
  )
  const [scale, setScale] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const current = imageList[currentIndex]
  const displaySrc = current?.displaySrc || current?.src || ''

  const goPrev = useCallback(() => {
    setCurrentIndex(i => Math.max(0, i - 1))
    setScale(1)
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex(i => Math.min(imageList.length - 1, i + 1))
    setScale(1)
  }, [imageList.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(s + 0.25, 4))
      if (e.key === '-') setScale(s => Math.max(s - 0.25, 0.25))
      if (e.key === '0') setScale(1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, goPrev, goNext])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    setScale(s => Math.min(Math.max(s + delta, 0.25), 4))
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = displaySrc
    a.download = current?.defaultName || `image_${Date.now()}.jpg`
    a.click()
  }

  if (!current) return null

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[10000] flex flex-col"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {imageList.length > 1 && (
            <span className="text-gray-400 text-sm">{currentIndex + 1} / {imageList.length}</span>
          )}
          <span className="text-gray-300 text-sm truncate max-w-xs">{current.alt || current.defaultName || 'Hình ảnh'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setScale(s => Math.max(s - 0.25, 0.25))}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700 transition-colors text-lg font-bold">−</button>
          <span className="text-gray-400 text-xs w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(s + 0.25, 4))}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700 transition-colors text-lg font-bold">+</button>
          <button onClick={() => setScale(1)} className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">100%</button>
          <button onClick={handleDownload}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700 transition-colors ml-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onWheel={handleWheel}
      >
        {imageList.length > 1 && currentIndex > 0 && (
          <button onClick={goPrev}
            className="absolute left-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <img
          key={displaySrc}
          src={displaySrc}
          alt={current.alt || ''}
          onLoadStart={() => setIsLoading(true)}
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
          style={{
            transform: `scale(${scale})`,
            transition: 'transform 0.1s ease',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            cursor: scale > 1 ? 'grab' : 'default',
          }}
          draggable={false}
        />

        {imageList.length > 1 && currentIndex < imageList.length - 1 && (
          <button onClick={goNext}
            className="absolute right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
      </div>

      {/* Thumbnails */}
      {imageList.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-3 overflow-x-auto flex-shrink-0 bg-black/40">
          {imageList.map((img, idx) => (
            <button key={idx} onClick={() => { setCurrentIndex(idx); setScale(1) }}
              className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${idx === currentIndex ? 'border-blue-400' : 'border-transparent hover:border-gray-500'}`}>
              <img src={img.displaySrc || img.src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
