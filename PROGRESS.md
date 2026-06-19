# Deplao Web — Progress

## ✅ Done

| Prompt | File | Ghi chú |
|--------|------|---------|
| infra | `docker-compose.yml` | postgres:5433, redis:6379, healthcheck cả 2 |
| infra | `.env` | MASTER_KEY + AUDIT_HMAC_KEY generated thật |
| infra | `prisma/schema.prisma` | 13 tables, Prisma 5, migration `init` applied |
| 2.1 | `src/types/index.ts` | WorkerCommand, WorkerEvent, ZaloCreds, SessionRecord, PoolConfig — zero `any` |
| 2.2 | `src/workers/zalo.worker.ts` | zca-js quirks đã xử lý, HEARTBEAT_ACK ok |

## 🔄 Đang làm
- **Prompt 2.3** — `src/services/session-pool.service.ts`

## ⏳ Chưa làm

### Phase 2 — Core Services
- 2.3 `session-pool.service.ts` — fork/kill workers, track SessionRecord
- 2.4 `vault.service.ts` — AES-256-GCM encrypt/decrypt credentials
- 2.5 `vault-internal.controller.ts` — one-time token endpoint cho workers

### Phase 3 — API & Gateway
- 3.1 `zalo.controller.ts` — REST: connect, disconnect, send message
- 3.2 `zalo-socket.gateway.ts` — Socket.io: real-time events tới browser
- 3.3 Redis pub/sub bridge — worker → Redis → Socket.io

### Phase 4 — Auth
- 4.1 `auth.service.ts` — JWT access 15m + refresh 7d
- 4.2 `auth.controller.ts` — login, refresh, logout

### Phase 5 — Frontend
- 5.1 Next.js 15 setup + Zustand stores
- 5.2 Unified inbox UI
- 5.3 Account management panel

## Bugs & Gotchas đã gặp
| Vấn đề | Giải pháp |
|--------|-----------|
| Port 5432 bị chiếm | Dùng 5433 trong docker-compose + DATABASE_URL |
| Prisma 7 breaking change | Downgrade Prisma 5 |
| `zca-js` subpath không export | Import `LoginQRCallbackEventType` từ root `'zca-js'` |
| `loginQR` trả về `API` không phải credentials | Không cần gọi `login()` sau QR |
| `sendFriendRequest` arg order | `(msg, userId)` — message TRƯỚC userId |
