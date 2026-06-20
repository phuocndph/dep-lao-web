# Deplao Web — Progress Tracker

## Tổng quan nhanh

```
Phase 1 — Infra        ████████████ DONE
Phase 2 — Core         ████████████ DONE
Phase 3 — API/Gateway  ████████████ DONE
Phase 4 — Auth         ████████████ DONE
Phase 5 — Frontend     ████████████ DONE
Phase 6 — Features     ░░░░░░░░░░░░ TODO
```

---

## ✅ Phase 1 — Infrastructure

| # | File | Nội dung |
|---|------|----------|
| 1.1 | `docker-compose.yml` | postgres:5433, redis:6379, healthcheck cả 2 |
| 1.2 | `.env` | MASTER_KEY + AUDIT_HMAC_KEY generated, DATABASE_URL port 5433 |
| 1.3 | `prisma/schema.prisma` | 13 tables, Prisma 5, migration `init` applied |

---

## ✅ Phase 2 — Core Services

| # | File | Nội dung |
|---|------|----------|
| 2.1 | `src/types/index.ts` | WorkerCommand, WorkerEvent, ZaloCreds, SessionRecord, PoolConfig — zero `any` |
| 2.2 | `src/workers/zalo.worker.ts` | loginQR, loginCookie, listeners, rate limit 20msg/min, HEARTBEAT_ACK |
| 2.3 | `src/pool/session-pool.service.ts` | NestJS Injectable — spawn/kill/restore workers, Redis session state, pub/sub, healthcheck, reconnect logic |
| 2.4 | `src/vault/vault.service.ts` | HKDF key hierarchy (MASTER→TENANT→ACCOUNT), AES-256-GCM encrypt/decrypt, one-time worker tokens TTL 60s |
| 2.5 | `src/vault/vault-internal.controller.ts` | InternalOnlyGuard (IP whitelist), POST /internal/vault/fetch, GET /api/vault/accounts/:id/status |

### Chi tiết Phase 2

<details>
<summary>2.2 — zalo.worker.ts — Các quirks đã giải quyết</summary>

- `loginQR()` trả về `Promise<API>` trực tiếp — không cần `login()` sau
- `sendFriendRequest(message, userId)` — message TRƯỚC, userId SAU
- `LoginQRCallbackEventType` import từ root `'zca-js'` (không phải subpath)
- `listener.on('disconnected', (code, reason))` — 2 arguments
- `listener.on('closed', ...)` — Zalo kill listener khi session khác mở
</details>

<details>
<summary>2.3 — session-pool.service.ts — Luồng chính</summary>

```
addAccount() → saveSession(Redis) → spawnWorker(fork) → waitWorkerReady(poll 200ms)
           → LOGIN_QR / LOGIN_COOKIE

DISCONNECTED event → 5s → reconnect() → check creds:{accountId} Redis → QR hoặc Cookie
ERROR fatal / errorCount≥5 → 10s → restartWorker() → kill+fork+reconnect
Worker exit unexpected → 5s → restartWorker()
healthTimer (30s) → HEARTBEAT ping → nếu stale>3x interval → restartWorker()
```

Redis keys dùng:
- `session:{accountId}` — SessionRecord JSON, TTL 24h
- `pool:accounts` — Set các accountId đang active
- `tenant:{accountId}` — tenantId (vì SessionRecord không có field này)
- `creds:{accountId}` — StoredCreds JSON (viết bởi vault service)
</details>

<details>
<summary>2.4 — vault.service.ts — Key hierarchy</summary>

```
MASTER_KEY (32 bytes, env)
  └─ HKDF-SHA256(salt='deplao-tenant-key-v1', info=tenantId)
       └─ TENANT_KEY (32 bytes)
            └─ HKDF-SHA256(salt='deplao-account-key-v1', info=accountId)
                 └─ ACCOUNT_KEY (32 bytes)
                      └─ AES-256-GCM(randomIV 12 bytes)
                           └─ BLOB: iv(12)+authTag(16)+ciphertext(hex)
```

Token flow: `issueWorkerToken()` → worker gọi `/internal/vault/fetch` → `consumeWorkerToken()` delete trước decrypt (one-time, không replay)
</details>

---

## 🔲 Phase 3 — REST API & Socket Gateway

> **Bắt đầu từ đây**

| # | File | Nội dung | Status |
|---|------|----------|--------|
| 3.1 | `src/zalo/zalo.controller.ts` | REST: POST /accounts, GET /accounts, GET /accounts/:id/status, POST /accounts/:id/send, POST /accounts/:id/add-friend, DELETE /accounts/:id | ✅ DONE |
| 3.1 | `src/zalo/zalo.module.ts` | NestJS module — wires SessionPoolService, VaultService, ZaloController; lifecycle start/stop | ✅ DONE |
| 3.1 | `src/zalo/dto/` | CreateAccountDto, SendMessageDto, AddFriendDto — class-validator | ✅ DONE |
| 3.1 | `src/app.module.ts` | Root module — ConfigModule global, RedisModule global, PrismaModule global, ZaloModule | ✅ DONE |
| 3.1 | `src/main.ts` | NestFactory bootstrap, ValidationPipe global | ✅ DONE |
| 3.1 | `src/redis/redis.module.ts` | @Global — provides REDIS + REDIS_PUB tokens (separate ioredis connections) | ✅ DONE |
| 3.1 | `src/prisma/prisma.service.ts` | PrismaClient + OnModuleInit/Destroy lifecycle | ✅ DONE |
| 3.1 | `src/prisma/prisma.module.ts` | @Global — provides PrismaService | ✅ DONE |
| 3.2 | `src/zalo/zalo-socket.gateway.ts` | Socket.io gateway, subscribe Redis pub/sub, push events tới browser | ⬜ TODO |

### Luồng real-time cần implement ở Phase 3

```
Worker process
  └─ emit MESSAGE_INCOMING
       └─ SessionPoolService.handleWorkerEvent()
            └─ redisPub.publish('zalo:messages', payload)
                 └─ ZaloSocketGateway (subscribe 'zalo:messages')
                      └─ io.to(tenantRoom).emit('message', payload)
                           └─ Browser (Next.js)
```

---

## ✅ Phase 4 — Authentication

| # | File | Nội dung | Status |
|---|------|----------|--------|
| 4.1 | `src/auth/auth.service.ts` | JWT access token 15m + refresh token 7d, bcrypt password | ✅ DONE |
| 4.2 | `src/auth/auth.controller.ts` | POST /auth/register, /auth/login, /auth/refresh, /auth/logout, GET /auth/me | ✅ DONE |
| 4.3 | `src/auth/guards/jwt-auth.guard.ts` | JwtAuthGuard thật — thay placeholder trong vault controller | ✅ DONE |
| 4.4 | `src/auth/jwt.strategy.ts` | JwtStrategy — tenantId trong mọi request từ JWT payload | ✅ DONE |
| 4.5 | `src/auth/dto/` | RegisterDto, LoginDto — class-validator | ✅ DONE |
| 4.6 | `prisma/schema.prisma` | UserSession model added + applied via prisma db push | ✅ DONE |

### Chi tiết Phase 4

<details>
<summary>4.x — Auth flow (verified)</summary>

- `POST /auth/register` → tạo Tenant (upsert) + User (role ADMIN) → trả access+refresh tokens
- `POST /auth/login` → 401 generic ("Invalid credentials") cho mọi lỗi — prevent user enumeration
- `POST /auth/refresh` → rotate refresh token (delete old, create new)
- `POST /auth/logout` → 204, xóa session
- `GET /auth/me` → @UseGuards(JwtAuthGuard) — trả user info
- ZaloController → `@UseGuards(JwtAuthGuard)` cả controller, tenantId lấy từ `req.user.tenantId`
- VaultPublicController → dùng real JwtAuthGuard (thay placeholder cũ)
- Tất cả endpoints đã test thực tế, pass hoàn toàn

</details>

---

## ✅ BACKEND HOÀN THÀNH

Tất cả Phase 1–4 done. Backend chạy ổn định tại port 3001.

---

## 🔄 Phase 5 — Frontend Next.js 15

---

## ✅ Phase 5 — Frontend (Next.js 15) — DONE

| # | File/Folder | Nội dung | Status |
|---|-------------|----------|--------|
| 5.1 | `frontend/` | Next.js 16.2.9 + Tailwind + Zustand setup | ✅ DONE |
| 5.2 | `frontend/stores/` | auth.store, accounts.store, chat.store (Zustand) | ✅ DONE |
| 5.3 | `frontend/app/(dashboard)/inbox/` | Unified inbox — real-time messages từ socket | ✅ DONE |
| 5.4 | `frontend/app/(dashboard)/accounts/` | Account grid, QR modal, socket listeners | ✅ DONE |
| 5.5 | `frontend/lib/socket-client.ts` | Socket.io singleton /zalo namespace | ✅ DONE |
| 5.6 | `frontend/lib/api-client.ts` | Axios + auto refresh interceptor | ✅ DONE |
| 5.7 | `frontend/app/(auth)/` | Login + Register pages | ✅ DONE |

### Chi tiết Phase 5

<details>
<summary>5.x — Frontend structure</summary>

```
frontend/
  app/
    (auth)/login/page.tsx         ← email + password + tenantSlug
    (auth)/register/page.tsx      ← email + password + displayName + tenantName + tenantSlug
    (auth)/layout.tsx             ← centered card layout
    (dashboard)/layout.tsx        ← sidebar + auth guard (fetchMe on mount)
    (dashboard)/inbox/page.tsx    ← real-time messages via socket
    (dashboard)/accounts/page.tsx ← account grid + QR modal + socket listeners
    (dashboard)/contacts/page.tsx ← placeholder
    page.tsx                      ← redirect /inbox
  lib/
    api-client.ts                 ← axios + auto 401 refresh + retry
    socket-client.ts              ← io singleton, /zalo namespace
    auth.ts                       ← localStorage token helpers
  stores/
    auth.store.ts                 ← login/register/logout/fetchMe
    accounts.store.ts             ← CRUD + socket status updates
    chat.store.ts                 ← incoming messages ring buffer (500)
  components/ui/                  ← Button, Input, Badge, Spinner
  components/layout/              ← Sidebar, Header
```

Chạy: `cd frontend && npm run dev` → http://localhost:3000
</details>

| 4.1-4.4 | `frontend/` | Auth + Accounts + Inbox + QR modal — Playwright pass | ✅ DONE |

---

## ✅ BACKEND HOÀN THÀNH
## ✅ FRONTEND CORE HOÀN THÀNH

---

## ✅ Phase 6.0 — Chuẩn bị (2026-06-20)

| # | Nội dung | Status |
|---|----------|--------|
| 6.0.1 | IPC inventory ~80 methods — mapping desktop → web API | ✅ DONE |
| 6.0.2 | Prisma schema mở rộng: 11 models mới (Draft, QuickMessage, PinnedMessage, FriendRequest, GroupMember, Sticker, ContactNote, WorkflowRun, AIAssistant, AIConversation, AIUsageLog) | ✅ DONE |
| 6.0.3 | Bug fix: F5 về login (layout.tsx effect ordering), delete account không xóa Redis, restoreSessions restore orphan | ✅ DONE |

---

## 🔄 Phase 6.1 — Shell + Inbox hoàn chỉnh

| # | Feature | Nội dung | Status |
|---|---------|----------|--------|
| 6.1.1 | App Shell | Sidebar chuẩn, navigation active state, responsive | 🔄 TODO |
| 6.1.2 | Inbox hoàn chỉnh | ConversationList + ChatWindow build sạch, fix import từ desktop | 🔄 TODO |
| 6.1.3 | Draft API | GET/PUT/DELETE /api/drafts/:threadId — save draft khi typing | 🔄 TODO |
| 6.1.4 | Quick Messages | CRUD /api/quick-messages — popup khi gõ `/` | 🔄 TODO |
| 6.1.5 | Pinned Messages | GET/POST/DELETE /api/messages/:threadId/pinned | 🔄 TODO |

---

## 🔲 Phase 6.2+ — Features (Tuần sau)

| # | Feature | Nội dung | Status |
|---|---------|----------|--------|
| 6.2 | Campaign Manager | BullMQ queue, rate limit Redis counter, dedup | ⬜ TODO |
| 6.3 | Workflow Engine | Port WorkflowEngineService từ desktop, thay SQLite→Postgres | ⬜ TODO |
| 6.4 | CRM Labels | Tags, contact assignment, search nâng cao | ⬜ TODO |
| 6.5 | Employee/Boss model | Permission middleware, employee view giới hạn | ⬜ TODO |
| 6.6 | Analytics | Dashboard báo cáo, audit log UI | ⬜ TODO |

---

## 🐛 Bugs & Gotchas đã gặp

| Vấn đề | Giải pháp |
|--------|-----------|
| Port 5432 bị chiếm bởi `he_thong_zalo-postgres-1` | Dùng **5433** trong docker-compose + DATABASE_URL |
| Prisma v7 breaking — bỏ `url` trong datasource | Downgrade **Prisma 5** |
| `zca-js` subpath không export types | Import `LoginQRCallbackEventType` từ root `'zca-js'` |
| `loginQR()` trả về `API` trực tiếp | Không cần gọi `login()` sau QR scan |
| `sendFriendRequest` arg order sai | `(message, userId)` — message TRƯỚC userId SAU |
| `tenantId` không có trong `SessionRecord` | Lưu riêng `tenant:{accountId}` trong Redis |
| Worker HEARTBEAT_ACK đầu tiên dùng để signal "ready" | `waitWorkerReady()` poll status !== 'initializing' |

---

## 📦 Packages cần install (chưa có trong package.json)

```bash
# Backend runtime
npm install @nestjs/common @nestjs/core @nestjs/platform-express
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install ioredis bullmq
npm install @nestjs/jwt passport-jwt bcryptjs
npm install @prisma/client prisma   # đã có trong devDeps, chuyển sang deps

# Backend dev
npm install --save-dev @types/bcryptjs @types/passport-jwt
```
