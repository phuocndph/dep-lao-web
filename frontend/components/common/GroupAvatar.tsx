'use client'

import React, { useState } from 'react'

export interface CachedGroupMember {
  userId: string
  displayName?: string
  avatar: string
}

export interface CachedGroupInfo {
  groupId: string
  name?: string
  avatar?: string
  members: CachedGroupMember[]
}

function MemberCell({ member, className }: { member: CachedGroupMember; className?: string }) {
  return (
    <div className={`overflow-hidden${className ? ' ' + className : ''}`}>
      {member.avatar ? (
        <img src={member.avatar} alt="" className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <div className="w-full h-full bg-purple-600 flex items-center justify-center text-white font-bold"
          style={{ fontSize: 'clamp(6px, 35%, 12px)' }}>
          {(member.displayName || '?').charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}

function Grid4({ members, sizeClass }: { members: CachedGroupMember[]; sizeClass: string }) {
  return (
    <div className={`${sizeClass} rounded-full overflow-hidden grid grid-cols-2 grid-rows-2 bg-gray-700 flex-shrink-0`}>
      {members.slice(0, 4).map((m, i) => <MemberCell key={i} member={m} />)}
    </div>
  )
}

function Grid3({ members, sizeClass }: { members: CachedGroupMember[]; sizeClass: string }) {
  return (
    <div className={`${sizeClass} rounded-full overflow-hidden flex flex-row bg-gray-700 flex-shrink-0`}>
      <div className="flex-1 h-full"><MemberCell member={members[0]} className="h-full" /></div>
      <div className="flex-1 h-full flex flex-col">
        <div className="flex-1"><MemberCell member={members[1]} className="h-full" /></div>
        <div className="flex-1 border-t border-gray-900/40"><MemberCell member={members[2]} className="h-full" /></div>
      </div>
    </div>
  )
}

function Grid2({ members, sizeClass }: { members: CachedGroupMember[]; sizeClass: string }) {
  return (
    <div className={`${sizeClass} rounded-full overflow-hidden flex flex-row bg-gray-700 flex-shrink-0`}>
      <div className="flex-1 h-full"><MemberCell member={members[0]} className="h-full" /></div>
      <div className="flex-1 h-full border-l border-gray-900/40"><MemberCell member={members[1]} className="h-full" /></div>
    </div>
  )
}

function Grid1({ members, sizeClass }: { members: CachedGroupMember[]; sizeClass: string }) {
  return (
    <div className={`${sizeClass} rounded-full overflow-hidden bg-gray-700 flex-shrink-0`}>
      <MemberCell member={members[0]} className="h-full w-full" />
    </div>
  )
}

export type GroupAvatarSize = 'xs' | 'sm' | 'md' | 'search' | 'lg'

const SIZE_MAP: Record<GroupAvatarSize, { sizeClass: string; fallbackText: string }> = {
  xs:     { sizeClass: 'w-8 h-8',   fallbackText: 'text-xs' },
  sm:     { sizeClass: 'w-9 h-9',   fallbackText: 'text-sm' },
  md:     { sizeClass: 'w-10 h-10', fallbackText: 'text-base' },
  search: { sizeClass: 'w-11 h-11', fallbackText: 'text-sm' },
  lg:     { sizeClass: 'w-16 h-16', fallbackText: 'text-2xl' },
}

interface GroupAvatarProps {
  avatarUrl?: string
  groupInfo?: CachedGroupInfo | null
  name: string
  size?: GroupAvatarSize
  className?: string
}

export default function GroupAvatar({ avatarUrl, groupInfo, name, size = 'md', className = '' }: GroupAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const { sizeClass, fallbackText } = SIZE_MAP[size]
  const cls = `${sizeClass} ${className}`.trim()

  if (avatarUrl && !imgError) {
    return <img src={avatarUrl} alt="" className={`${cls} rounded-full object-cover flex-shrink-0`} onError={() => setImgError(true)} />
  }

  const members = (groupInfo?.members || [])
    .filter(m => m.avatar && m.userId && m.userId !== 'undefined')
    .slice(0, 4)

  if (members.length >= 4) return <Grid4 members={members} sizeClass={cls} />
  if (members.length === 3) return <Grid3 members={members} sizeClass={cls} />
  if (members.length === 2) return <Grid2 members={members} sizeClass={cls} />
  if (members.length === 1) return <Grid1 members={members} sizeClass={cls} />

  return (
    <div className={`${cls} rounded-full bg-purple-600 flex items-center justify-center text-white ${fallbackText} font-bold flex-shrink-0`}>
      {(name || 'G').charAt(0).toUpperCase()}
    </div>
  )
}
