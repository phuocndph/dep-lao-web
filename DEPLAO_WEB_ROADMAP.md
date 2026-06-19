# Deplao Web Roadmap

Tài liệu này tóm tắt lộ trình tách Deplao desktop thành Deplao Web Platform.

## Mục tiêu v1

Deplao Web là web interface song song với Deplao desktop. Người dùng có thể truy cập inbox Zalo, gửi tin nhắn, quản lý contacts và chạy campaigns ngay trên browser, không cần cài app desktop.

Mục tiêu v1 trong 10 tuần:

- Web inbox hợp nhất: xem tin nhắn từ tất cả Zalo accounts trong một màn hình.
- Gửi tin nhắn 2 chiều từ browser: text, ảnh, file.
- Quản lý 100 tài khoản Zalo song song.
- QR login trên browser, cookie lưu server vault an toàn.
- Real-time: tin nhắn mới hiện ngay, không cần refresh.
- Multi-tenant: nhiều team dùng chung hệ thống, data độc lập.

## Tech Stack

- Backend API: NestJS + TypeScript strict, REST + WebSocket Socket.io.
- Frontend: Next.js 15 + React 18 + Tailwind CSS + Zustand.
- Database: PostgreSQL 16 + Prisma 5 ORM.
- Cache/Queue: Redis 7 + BullMQ + pub/sub.
- Zalo Bridge: `zca-js` v2.1.2, `child_process.fork()` per account.
- Auth: JWT access token 15 phút + refresh token 7 ngày.
- Deployment: Docker Compose trên VPS giai đoạn đầu.

## Nguyên tắc kiến trúc

- 1 Zalo account = 1 web listener = 1 child process riêng.
- Mọi DB query phải có `tenantId` để đảm bảo multi-tenant isolation.
- Không bao giờ log, return, hoặc stringify raw cookie, imei, userAgent của Zalo.
- Cookie/credentials phải lưu bằng AES-256-GCM trong vault, không lưu plaintext.
- Worker chỉ lấy credentials qua worker token TTL ngắn, dùng một lần.
- Tin nhắn real-time đi theo luồng: worker → Redis pub/sub → Socket.io gateway → browser.
- Desktop code chỉ dùng làm tham khảo/copy có chọn lọc; không sửa trực tiếp.

## Cấu trúc repo thực tế

```text
deplao-builder-main/
  backend/                  ← NestJS API, workers, Prisma  ✅ DONE
    package.json
    tsconfig.json
    .env
    prisma/schema.prisma
    src/
      main.ts
      app.module.ts
      types/index.ts
      workers/zalo.worker.ts
      pool/session-pool.service.ts
      vault/vault.service.ts
      vault/vault-internal.controller.ts
      zalo/ (controller, module, dto/)
      gateway/ (zalo-socket.gateway, gateway.module)
      prisma/ (service, module)
      redis/ (redis.module)
  frontend/                 ← Next.js app  ✅ core DONE
  docker-compose.yml        ← postgres:5433, redis:6379  ✅ DONE
  .env                      ← root env (Electron)
  src/                      ← Electron desktop (KHÔNG sửa)
```

---

## Lộ trình 10 tuần — Trạng thái hiện tại

### ✅ Tuần 1 — Setup & Schema (DONE)

- [x] Node, Docker Desktop, Git.
- [x] `backend/` + `frontend/` directory structure.
- [x] PostgreSQL (port 5433) + Redis (port 6379) qua Docker Compose.
- [x] Prisma schema — 13 tables: tenants, users, zalo_accounts, account_credentials, account_settings, contacts, labels, contact_labels, messages, campaigns, campaign_recipients, workflows, vault_audit_logs.
- [x] Migration `init` applied.
- [x] `CLAUDE.md` + quirks docs.

### ✅ Tuần 2 — Backend Core (DONE)

- [x] `zalo.worker.ts` — loginQR, loginCookie, listeners, rate limit 20msg/min, HEARTBEAT_ACK.
- [x] `session-pool.service.ts` — spawn/kill/restore workers, Redis session state, pub/sub, healthcheck, reconnect.
- [x] `vault.service.ts` — HKDF key hierarchy (MASTER→TENANT→ACCOUNT), AES-256-GCM, one-time worker tokens TTL 60s.
- [x] `vault-internal.controller.ts` — InternalOnlyGuard, POST /internal/vault/fetch, GET /api/vault/accounts/:id/status.

### ✅ Tuần 3 — REST API & WebSocket Gateway (DONE)

- [x] `backend/` setup đúng chuẩn — package.json riêng, tsconfig.json với decorators, .env PORT=3001.
- [x] `RedisModule` @Global — REDIS + REDIS_PUB tokens (2 connections riêng).
- [x] `PrismaModule` @Global — PrismaService lifecycle.
- [x] `ZaloModule` — factory providers cho SessionPoolService + VaultService, lifecycle start/stop.
- [x] `ZaloController` — 6 REST endpoints + rate limit qua Redis.
- [x] `ZaloSocketGateway` — namespace `/zalo`, subscribe `zalo:messages` + `zalo:status`, fan-out đến account rooms.
- [x] `GatewayModule` — wires gateway với SessionPoolService.
- [x] `AppModule` — root module, import tất cả.
- [x] `main.ts` — IoAdapter, ValidationPipe global.
- [x] **Test passed:** `✅ Connected` + `✅ Joined room` xác nhận WebSocket hoạt động.

**Milestone tuần 3:** `npm run start:dev` từ `backend/` → server lên port 3001, WebSocket `/zalo` accept connection, join room thành công.

### ✅ Tuần 4 — Authentication (DONE)

- [x] `backend/src/auth/auth.service.ts` — bcrypt rounds=12, JWT sign (access 15m + refresh UUID 7d), rotate on refresh.
- [x] `backend/src/auth/auth.controller.ts` — POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/me.
- [x] `backend/src/auth/guards/jwt-auth.guard.ts` — JwtAuthGuard thật, apply toàn bộ `/api/*`.
- [x] `backend/src/auth/jwt.strategy.ts` — extract tenantId từ JWT payload.
- [x] `backend/src/auth/auth.module.ts` — wired.
- [x] Login yêu cầu `tenantSlug` — phân biệt user cùng email ở các tenant khác nhau.
- [x] Email unique per tenant (không global) — intentional multi-tenant design.

### ✅ Tuần 5 — Frontend Next.js 15 (DONE — core)

- [x] `frontend/` — Next.js 15 App Router + Tailwind + Zustand setup (port 3000).
- [x] `frontend/stores/auth.store.ts` — login/register/logout/fetchMe, JWT helpers.
- [x] `frontend/stores/accounts.store.ts` — CRUD + socket status/info updates.
- [x] `frontend/stores/chat.store.ts` — thread-based (`threads: Record<threadId, Thread>`), addIncomingMessage/addOutboundMessage/updateOutboundStatus/selectThread.
- [x] `frontend/app/(auth)/` — register + login page (với tenantSlug field).
- [x] `frontend/app/(dashboard)/accounts/` — Account management, QR login modal.
- [x] `frontend/app/(dashboard)/inbox/` — **2-column realtime chat UI** (thread list + conversation view).
- [x] Socket.io client — namespace `/zalo`, autoConnect:false, connect sau login.
- [x] QR modal — nhận `qr:update` từ Socket.io, hiện QR + countdown 120s.

**Inbox chat UI (hoàn chỉnh):**
- Cột trái 320px: thread list, search, unread badge đỏ, account badge (SĐT tài khoản Zalo)
- Cột phải: header contact, message bubbles (inbound trái/trắng — outbound phải/xanh), nhóm ngày ("Hôm nay"/"Hôm qua"/DD/MM/YYYY), auto-scroll
- Input bar: Enter gửi, Shift+Enter newline, optimistic update + rollback khi lỗi
- Join rooms cho ALL accounts (không filter status) + rejoin khi socket reconnect

**Bug đã fix:**
- `createAccount` response shape: `{ accountId }` → `{ id }` (frontend dùng `account.id`)
- QR race condition: gateway replay `qr:update` khi client join room nếu session `qr_pending`
- `CreateAccountDto.phone` required → 400 khi body rỗng → fix thành `@IsOptional()`
- Inbox miss messages: chỉ join rooms `connected` → fix join ALL + rejoin on reconnect

### ✅ UX Improvement — QR-first flow (DONE)

**Backend:**
- [x] `types/index.ts` — `SessionRecord.phone: string | null`, `WorkerEventLoginSuccess.payload.phone?: string`
- [x] `dto/create-account.dto.ts` — `phone` và `displayName` đều `@IsOptional()`, bỏ `@IsNotEmpty()`
- [x] `zalo.controller.ts` — tạo account với `phone: dto.phone ?? null`
- [x] `session-pool.service.ts` — inject `PrismaService`; LOGIN_SUCCESS handler gọi `prisma.zaloAccount.update(zaloUid, displayName, phone, status=CONNECTED)`
- [x] `zalo.module.ts` — factory inject `PrismaService` vào `SessionPoolService`
- [x] `zalo-socket.gateway.ts` — `account:connected` event thêm `phone` field

**Frontend:**
- [x] `accounts.store.ts` — `phone`/`displayName: string | null`, `addAccount()` không nhận args, thêm `updateAccountInfo()`
- [x] `accounts/page.tsx` — bỏ form nhập SĐT; click button → POST ngay → open QR modal với spinner → QR hiện khi socket fire; "Hủy" DELETE account; "Làm mới" tạo account mới; error display nếu POST fail

### 🔲 Tuần 6 — Deploy (TIẾP THEO)

- [ ] Dockerize `backend/` và `frontend/`.
- [ ] Deploy lên VPS hoặc Railway.
- [ ] Setup Cloudflare Tunnel.
- [ ] Test với 3-5 Zalo accounts thật trên production.

### 🔲 Tuần 7-8 — Tính năng chính

- [ ] Campaign manager — BullMQ queue, rate limit Redis counter, dedup.
- [ ] Workflow engine — port `WorkflowEngineService` từ desktop, thay SQLite→PostgreSQL.
- [ ] Boss/nhân viên — employee model, permission middleware.
- [ ] CRM labels — tags, contact assignment, search nâng cao.

### 🔲 Tuần 9-10 — Polish & Scale

- [ ] Analytics dashboard, báo cáo nhân viên, audit log UI.
- [ ] Performance tuning, key rotation vault, load test 100 accounts.

---

## REST API hiện có (port 3001)

| Method | Path | Mô tả |
|--------|------|-------|
| POST | /api/accounts | Tạo account + spawn worker |
| GET | /api/accounts?tenantId= | List accounts |
| DELETE | /api/accounts/:id | Xóa account |
| GET | /api/accounts/:id/status | Session status |
| POST | /api/accounts/:id/send | Gửi tin nhắn |
| POST | /api/accounts/:id/add-friend | Kết bạn |
| POST | /internal/vault/fetch | Worker fetch creds |
| GET | /api/vault/accounts/:id/status | Credential status |

## WebSocket (ws://localhost:3001/zalo)

Client gửi `auth: { token }` khi kết nối. Phase 4 sẽ verify JWT thật.

| Event | Chiều | Mô tả |
|-------|-------|-------|
| `join_account_room` | C→S | Subscribe nhận events của account |
| `send_message` | C→S | Gửi tin qua worker |
| `ping` | C→S | Keepalive |
| `server:ready` | S→C | Confirm kết nối |
| `message:new` | S→C | Tin nhắn mới từ Zalo |
| `qr:update` | S→C | QR code mới để scan |
| `account:connected` | S→C | Login thành công |
| `account:status` | S→C | Thay đổi trạng thái |

---

## Lỗi phổ biến cần tránh

- Spawn nhiều workers cùng `accountId`: luôn check process đang tồn tại.
- Listener bị kill khi mở Zalo Web nơi khác: handle event `closed`, set disconnected và schedule reconnect.
- Cookie bị lộ qua log/API: review mọi `console.log` và response.
- Prisma query thiếu `tenantId`: cần middleware/pattern bắt buộc — sẽ implement ở Phase 4.
- Còn `ipcRenderer` trong Next.js: grep frontend để đảm bảo zero result.
- Worker crash loop: restart tối đa 5 lần, sau đó set account status `ERROR`.
- Rate limit Zalo: hard limit 20 tin/phút/account, 15 kết bạn/ngày/account — đã implement qua Redis counter.
- Import `.js` extension trong `backend/src/`: KHÔNG dùng — CommonJS + ts-node không cần.
- Tạo NestJS files ở root `src/`: KHÔNG — luôn tạo trong `backend/src/`.

## Milestone quan trọng

- ✅ **Tuần 2:** Backend core — workers, pool, vault hoạt động.
- ✅ **Tuần 3:** REST API + WebSocket verified end-to-end.
- ✅ **Tuần 4:** Auth — JWT, guard, tenant isolation thật sự.
- ✅ **Tuần 5:** Frontend core — register/login/dashboard/accounts/QR modal hoạt động.
- 🔲 **Tuần 6:** Dockerize + deploy VPS.
