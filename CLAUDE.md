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
- Auth flow: register → login → /deplao (Deplao SPA) → logout
- Socket.io: namespace /zalo, autoConnect:false, connect sau login
- CORS: backend main.ts enableCors origin:localhost:3000
- Chạy: cd frontend && npm run dev

### /deplao — Deplao Desktop SPA embedded (HOÀN THÀNH)

Toàn bộ `src/ui/` (desktop React SPA) được embed vào Next.js tại route `/deplao`.
Sau khi login thành công → redirect thẳng đến `/deplao`.

**Cấu trúc:**
```
frontend/
├── deplao-ui/                     ← copy nguyên từ src/ui/
│   ├── App.tsx                    ← entry point (unchanged)
│   ├── components/, store/, hooks/, lib/, utils/, features/
│   ├── index.css                  ← Tailwind v3 → v4 fixed (@reference)
│   └── lib/ipc.ts                 ← OVERRIDE: re-export web adapter từ ../../lib/ipc
│   └── lib/electronPolyfill.ts    ← stub window.electronAPI (on/app/shell/…)
├── app/deplao/page.tsx            ← 'use client', dynamic import App (ssr:false)
├── configs/                       ← copy từ src/configs/ (channelConfig, BuildConfig, …)
├── utils/                         ← copy từ src/utils/ (Logger, profileUtils, aiUtils)
├── services/                      ← copy từ src/services/ (FacebookScanTypes, erp/permissions)
├── models/erp/                    ← copy từ src/models/erp/ (Permission)
└── assets/                        ← copy từ src/assets/ (login/hd_login_fb_cookie.png)
```

**Alias mapping (tsconfig.json + next.config.ts):**
- `@deplao/*` → `./deplao-ui/*` (Turbopack resolveAlias + webpack alias)
- Tất cả `from '@/'` trong deplao-ui được thay thành `from '@deplao/'`

**Packages thêm vào frontend:**
`reactflow`, `recharts`, `react-zoom-pan-pinch`, `dompurify`, `uuid`, `react-quill-new`, `xlsx`

**next.config.ts:**
- `typescript.ignoreBuildErrors: true` — type errors trong deplao-ui là expected, fix dần
- `eslint` key ĐÃ XÓA — Next.js 16 không chạy ESLint trong `next build` by default, key cũ gây deprecation warning

### chat.store.ts — thread-based (không còn flat array)

- `threads: Record<threadId, Thread>` — mỗi thread là 1 conversation
- `addIncomingMessage({ accountId, message })` — nhận payload từ `message:new` socket
- `addOutboundMessage(msg)` + `updateOutboundStatus(tempId, threadId, status)` — optimistic send
- `selectThread(threadId)` — reset unreadCount về 0

### inbox/page.tsx — 2-column chat UI

- **Cột trái (320px):** thread list, search, unread badge, account badge (SĐT Zalo nào handle)
- **Cột phải:** conversation header, message bubbles (inbound trái/trắng, outbound phải/xanh), nhóm theo ngày ("Hôm nay"/"Hôm qua"/DD/MM/YYYY), auto-scroll
- **Input bar:** Enter gửi, Shift+Enter xuống dòng, optimistic update + rollback nếu lỗi
- **Room joining:** join tất cả account rooms (không phải chỉ connected) + re-join khi socket reconnect

---

## Bug đã fix

- CORS: app.enableCors({ origin:'http://localhost:3000', credentials:true })
- Password minLength: 8 (khớp backend DTO)
- QR modal không hiện: `createAccount` trả `{ accountId }` thay vì `{ id }` → frontend dùng `account.id` bị `undefined` → `joinAccountRoom(undefined)` join room sai
- QR race condition: QR event có thể fire trước khi client join room → gateway giờ replay `qr:update` ngay khi client join nếu session đang `qr_pending` và có `lastQrDataUrl`
- POST /api/accounts trả 400 khi body rỗng `{}`: `@IsNotEmpty()` còn sót trong DTO → đã bỏ hoàn toàn
- Inbox không nhận tin realtime: 3 root causes — (1) `CreateAccountDto.phone` required → 400 khi POST body rỗng → account không tạo được; (2) `createAccount` trả `{ accountId }` → `joinAccountRoom(undefined)` sai room; (3) inbox chỉ join rooms cho `status=connected` → miss messages khi session đang restore sau backend restart
- Socket room bị mất khi reconnect: inbox giờ listen `connect` event để re-join tất cả rooms
- `.charAt()` crash trên undefined string: fix toàn bộ 8 file trong `deplao-ui/` và `frontend/components/` — pattern `(str || '?').charAt(0)` thay vì `str.charAt(0)` trực tiếp
- `eslint` key deprecated trong next.config.ts: đã xóa — Next.js 16 không cần, không chạy ESLint trong build

---

## Decisions đã chốt (bổ sung)

| Quyết định | Lý do |
|-----------|-------|
| Embed toàn bộ `src/ui/` vào `frontend/deplao-ui/` | Không port từng component — nhanh hơn 10x, full feature ngay |
| `@deplao/*` alias thay vì `@/` cho deplao-ui | Tránh conflict với `frontend/lib/`, `frontend/components/` của Next.js |
| `deplao-ui/lib/ipc.ts` override → re-export web adapter | Desktop components dùng `import ipc from '@deplao/lib/ipc'` nhận web REST adapter |
| `window.electronAPI` polyfill (stub) | App.tsx dùng `?.on(...)` với optional chaining → safe khi stub là `{}` |
| `typescript.ignoreBuildErrors: true` trong next.config.ts | Type errors trong deplao-ui là expected (mixed React 18/19, any types) — fix dần |
| Login redirect → `/deplao` thay vì `/inbox` | Deplao SPA là UI chính, các routes `/inbox`, `/accounts` là cũ |
| Copy `src/configs/`, `src/utils/`, `src/models/`, `src/services/` vào `frontend/` | Relative imports từ deplao-ui components thoát ra ngoài deplao-ui/ |
| `@reference "tailwindcss"` thêm vào deplao-ui/index.css | Tailwind v4 yêu cầu directive này khi dùng `@apply` trong file CSS không phải main |
| `SessionRecord.lastQrDataUrl` lưu QR mới nhất | Gateway replay QR khi client join room muộn (race condition) |
| `SessionPoolService.getSession(id)` public | Gateway cần check session state trong `handleJoinRoom` |
| `createAccount` trả `AccountListItem` shape (có `id`) | Frontend store dùng `account.id` để `joinAccountRoom` |
| Email unique per tenant (không global) | Multi-tenant: cùng email có thể dùng ở nhiều workspace khác nhau |
| Login yêu cầu `tenantSlug` | Phân biệt user cùng email ở các tenant khác nhau |
| `CreateAccountDto.phone` optional (không require) | UX mới: QR hiện ngay, phone lấy từ Zalo sau khi login |
| `SessionRecord.phone: string \| null` | Account tạo trước khi biết phone từ Zalo |
| `WorkerEventLoginSuccess.payload.phone?: string` | zca-js có thể không trả phone — để null nếu không có |
| LOGIN_SUCCESS → Prisma update ZaloAccount | Ghi `zaloUid`, `displayName`, `phone`, `status=CONNECTED` sau khi worker login xong |
| `SessionPoolService` inject `PrismaService` | Pool cần update DB khi LOGIN_SUCCESS |
| `account:connected` socket event trả thêm `phone` | Frontend cần cập nhật card sau khi kết nối |
| `addAccount()` store không nhận args | Phone không còn được user nhập |
| `updateAccountInfo()` trong accounts.store | Cập nhật displayName + phone từ `account:connected` event |
| Inbox join tất cả rooms (không filter `connected`) | Session đang restore chưa về `connected` → filter gây miss messages |
| Re-join rooms khi socket `connect` event | Server-side rooms bị xóa khi disconnect — phải rejoin sau reconnect |
| `chat.store.ts` dùng `threads` map thay flat array | Thread-based cho phép group by conversation, unread count per thread |

---

## UX Flow — Thêm tài khoản (đã thay đổi)

**Cũ:** User nhập SĐT → Submit → Đợi → QR hiện

**Mới:**
1. Click "+ Thêm tài khoản" → POST /api/accounts (body rỗng)
2. Nhận `{ id }` → `joinAccountRoom(id)` → Mở QR modal với spinner
3. Khi `qr:update` socket fire → thay spinner bằng QR image
4. Khi `account:connected` fire → đóng modal, update card với displayName + phone từ Zalo
5. QR modal có: countdown 120s, nút "Làm mới" (tạo account mới), nút "Hủy" (DELETE account)

---

## Known issues (chưa fix)

- `DELETE /api/accounts/:id` với UUID format sai → 400 (đã bắt bởi `PrismaClientValidationError` → `mapError` → 400 BAD_REQUEST). Trước đây ghi nhầm là 500 — đã verify code xử lý đúng.
- Các component desktop-ported (`ChatHeader`, `MessageBubbles`, `MessageInput`, `UserProfilePopup`) trong `frontend/components/chat/` còn import `@/store/accountStore`, `@/store/appStore`, `@/lib/localMedia`, `@/lib/bankCardCache`, `@/hooks/useIsMobile`, `@/hooks/useChannelCapability` — chưa tồn tại trong web. Các component này chưa được dùng trong inbox page, là việc tiếp theo khi port chat UI desktop-style.
