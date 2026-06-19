# Deplao Web — Context cho AI

## Dự án
Web interface cho Zalo multi-account management (100 tài khoản).
Chạy song song với Deplao desktop (Electron + React + SQLite).

## Stack
- Backend: NestJS + TypeScript strict (`backend/src/`)
- Frontend: Next.js 15 + Tailwind + Zustand (`frontend/` — chưa tạo)
- DB: PostgreSQL port **5433** (Prisma 5) + Redis port 6379
- Zalo: zca-js v2.1.2 — mỗi account = 1 `child_process.fork()` riêng
- Auth: JWT access 15m + refresh 7d

---

## Cấu trúc repo

```
deplao-builder-main/          ← root (Electron desktop app — KHÔNG sửa)
├── backend/                  ← NestJS web backend ← LÀM VIỆC Ở ĐÂY
│   ├── package.json          ← NestJS deps (CommonJS, ts-node)
│   ├── tsconfig.json         ← experimentalDecorators, emitDecoratorMetadata
│   ├── .env                  ← PORT=3001, DATABASE_URL, REDIS_URL, MASTER_KEY…
│   ├── prisma/
│   │   └── schema.prisma     ← 13 tables, Prisma 5
│   └── src/
│       ├── main.ts           ← NestFactory, IoAdapter, ValidationPipe
│       ├── app.module.ts     ← root module
│       ├── types/index.ts    ← tất cả shared types
│       ├── workers/zalo.worker.ts
│       ├── pool/session-pool.service.ts
│       ├── vault/
│       │   ├── vault.service.ts
│       │   └── vault-internal.controller.ts
│       ├── zalo/
│       │   ├── dto/
│       │   ├── zalo.controller.ts
│       │   └── zalo.module.ts
│       ├── gateway/
│       │   ├── zalo-socket.gateway.ts
│       │   └── gateway.module.ts
│       ├── prisma/           ← PrismaService, PrismaModule (@Global)
│       └── redis/            ← RedisModule (@Global) — REDIS + REDIS_PUB tokens
├── frontend/                 ← Next.js (chưa tạo)
├── docker-compose.yml        ← postgres:5433, redis:6379
└── src/                      ← Electron desktop (KHÔNG đụng vào)
```

---

## Rules bắt buộc — KHÔNG được vi phạm

- Mọi Prisma query phải có `where: { tenantId }`
- Không bao giờ log hoặc return raw `cookie` / `imei` / `userAgent`
- 1 ZaloAccount = 1 worker process — không share listener
- TypeScript strict — không dùng `any` (dùng `Record<string, unknown>`)
- Port PostgreSQL là **5433** (không phải 5432 — bị chiếm bởi project khác)
- Raw ZaloCreds không tồn tại trong memory quá 60s
- **Mọi file NestJS đều nằm trong `backend/`** — không tạo ở root `src/`
- Import paths trong `backend/src/` dùng **không có `.js` extension** (CommonJS + ts-node)

---

## Decisions đã chốt

| Quyết định | Lý do |
|-----------|-------|
| PostgreSQL port 5433 | 5432 bị chiếm bởi `he_thong_zalo-postgres-1` |
| Prisma 5 (không dùng v7) | v7 breaking: bỏ `url` trong datasource |
| `Record<string, unknown>` thay `any` | TypeScript strict toàn bộ codebase |
| `LoginQRCallbackEventType` import từ root `'zca-js'` | Subpath không export type này |
| `zalo.loginQR()` → `Promise<API>` trực tiếp | Không cần gọi `zalo.login()` sau QR |
| `api.sendFriendRequest(msg, userId)` | Thứ tự: message TRƯỚC, userId SAU |
| `listener.on('closed', ...)` xử lý riêng | Zalo kill listener khi mở session khác |
| `tenantId` lưu Redis key `tenant:{accountId}` | `SessionRecord` type không có field này |
| Worker token TTL 60s, delete trước decrypt | One-time use, không thể replay |
| `backend/` riêng với `package.json` + `tsconfig.json` | Root là Electron app, không tương thích (thiếu decorators, CommonJS khác) |
| NestJS chạy với `ts-node` (không compile) | Dev workflow nhanh hơn |
| `redisSub` tạo trong `afterInit()` | Redis không cho subscribe + publish trên cùng 1 connection |
| `PORT=3001` cho backend | Worker dùng `VAULT_INTERNAL_URL=http://127.0.0.1:3001` |
| Không có `.js` extension trong imports | CommonJS + ts-node không cần extension |

---

## Cách chạy backend

```bash
cd backend
npm run start:dev
# → http://localhost:3001
```

Yêu cầu Docker Compose đang chạy:
```bash
docker compose up -d   # postgres:5433 + redis:6379
```

---

## Files đã hoàn thành

```
backend/
├── package.json                              ✅ NestJS deps + ts-node
├── tsconfig.json                             ✅ decorators enabled
├── .env                                      ✅ PORT=3001, keys, DB, Redis
├── prisma/schema.prisma                      ✅ 13 tables
└── src/
    ├── main.ts                               ✅ IoAdapter, ValidationPipe
    ├── app.module.ts                         ✅ root module
    ├── types/index.ts                        ✅ WorkerCommand, WorkerEvent, SessionRecord…
    ├── workers/zalo.worker.ts                ✅ loginQR, loginCookie, listeners, rate limit
    ├── pool/session-pool.service.ts          ✅ spawn/kill/restore, healthcheck, pub/sub
    ├── vault/vault.service.ts                ✅ AES-256-GCM + HKDF
    ├── vault/vault-internal.controller.ts    ✅ /internal/vault/fetch + /api/vault/accounts/:id/status
    ├── zalo/dto/create-account.dto.ts        ✅ class-validator
    ├── zalo/dto/send-message.dto.ts          ✅ SendMessageDto + AddFriendDto
    ├── zalo/zalo.controller.ts               ✅ 6 REST endpoints + rate limit
    ├── zalo/zalo.module.ts                   ✅ factory providers, lifecycle start/stop
    ├── gateway/zalo-socket.gateway.ts        ✅ Socket.io /zalo namespace, Redis sub
    ├── gateway/gateway.module.ts             ✅
    ├── prisma/prisma.service.ts              ✅ @Global
    ├── prisma/prisma.module.ts               ✅
    └── redis/redis.module.ts                 ✅ @Global — REDIS + REDIS_PUB tokens
```

---

## Phase hiện tại: Phase 4 — Authentication

### Việc tiếp theo
**4.1** `backend/src/auth/auth.service.ts` — bcrypt password, JWT sign/verify, refresh token
**4.2** `backend/src/auth/auth.controller.ts` — POST /auth/login, /auth/refresh, /auth/logout
**4.3** `backend/src/auth/jwt.guard.ts` — JwtAuthGuard thật, thay placeholder trong vault controller
**4.4** `backend/src/auth/tenant.middleware.ts` — inject tenantId vào request từ JWT payload

---

## Redis key schema

| Key | Value | TTL | Viết bởi |
|-----|-------|-----|----------|
| `session:{accountId}` | `SessionRecord` JSON | 24h | SessionPoolService |
| `pool:accounts` | Set accountIds | — | SessionPoolService |
| `tenant:{accountId}` | tenantId string | — | SessionPoolService |
| `creds:{accountId}` | `StoredCreds` JSON | — | VaultService |
| `zalo:status` | pub/sub channel | — | SessionPoolService |
| `zalo:messages` | pub/sub channel | — | SessionPoolService |
| `rate:{accountId}:send` | counter | 60s | ZaloController |
| `rate:{accountId}:friend` | counter | 86400s | ZaloController |

---

## REST API đã có

| Method | Path | Mô tả |
|--------|------|-------|
| POST | /api/accounts | Tạo account + spawn worker (QR flow) |
| GET | /api/accounts?tenantId= | List accounts + session status |
| DELETE | /api/accounts/:id | Remove account + kill worker |
| GET | /api/accounts/:id/status | Session status từ pool |
| POST | /api/accounts/:id/send | Gửi tin nhắn (rate limit 20/min) |
| POST | /api/accounts/:id/add-friend | Kết bạn (rate limit 15/ngày) |
| POST | /internal/vault/fetch | Worker fetch creds (IP whitelist) |
| GET | /api/vault/accounts/:id/status | Credential status |

## WebSocket events (namespace: `/zalo`)

| Direction | Event | Payload |
|-----------|-------|---------|
| Client → Server | `join_account_room` | accountId |
| Client → Server | `leave_account_room` | accountId |
| Client → Server | `send_message` | `{accountId, threadId, threadType, content}` |
| Client → Server | `ping` | — |
| Server → Client | `server:ready` | `{socketId}` |
| Server → Client | `room:joined` | `{accountId}` |
| Server → Client | `message:new` | IncomingMessage payload |
| Server → Client | `account:status` | status event |
| Server → Client | `qr:update` | `{accountId, qrDataUrl}` |
| Server → Client | `account:connected` | `{accountId, displayName}` |

---

## zca-js quirks (v2.1.2 — phát hiện thực tế)

- `loginQR()` → `Promise<API>` trực tiếp, không cần `login()` sau
- QR image nằm ở `event.data.image`
- `sendFriendRequest(message, userId)` — message TRƯỚC, userId SAU
- Import `LoginQRCallbackEventType` từ root `'zca-js'`
- `listener.on('disconnected', (code, reason))` — 2 arguments
- `listener.on('closed', ...)` — Zalo kill khi session khác mở
- Worker emit `HEARTBEAT_ACK` ngay khi khởi động → signal "process ready"

---

## Files desktop nên tham khảo khi port

- `src/services/zalo/ZaloService.ts` — session management pattern
- `src/services/workflow/WorkflowEngineService.ts` — workflow engine
- `src/services/crm/CRMQueueService.ts` — CRM queue
- `electron/ipc/` — IPC patterns → thay bằng REST/Socket.io

---

## Backend — HOÀN THÀNH

Auth: JWT 15m + refresh UUID 7d, rotate on refresh, bcrypt rounds=12
tenantId luôn lấy từ JWT — không từ body/query
ZaloController: @UseGuards(JwtAuthGuard), ownership check accountId vs tenantId
Backend chạy: cd backend && npm run start:dev (port 3001)
Migration hiện tại: add_user_sessions (applied via prisma db push)

---

## Frontend — HOÀN THÀNH (core)

- Next.js 15 App Router, port 3000
- Auth flow: register → login → dashboard → logout
- Socket.io: namespace /zalo, autoConnect:false, connect sau login
- CORS: backend main.ts enableCors origin:localhost:3000
- Ring buffer 500 tin nhắn trong chat.store.ts
- Chạy: cd frontend && npm run dev

## Bug đã fix

- CORS: app.enableCors({ origin:'http://localhost:3000', credentials:true })
- Password minLength: 8 (khớp backend DTO)
