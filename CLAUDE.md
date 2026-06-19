# Deplao Web — Context

## Dự án
Web interface cho Zalo multi-account management (100 tài khoản).
Chạy song song với Deplao desktop (Electron + React + SQLite).

## Stack
- Backend: NestJS + TypeScript strict (src/)
- Frontend: Next.js 15 + Tailwind + Zustand (frontend/ — chưa tạo)
- DB: PostgreSQL port **5433** (Prisma 5) + Redis port 6379
- Zalo: zca-js v2.1.2 — mỗi account = 1 child_process.fork() riêng
- Auth: JWT access 15m + refresh 7d

## Rules bắt buộc
- Mọi Prisma query phải có `where: { tenantId }`
- Không bao giờ log hoặc return raw cookie/imei/userAgent
- 1 ZaloAccount = 1 worker process — không share listener
- TypeScript strict — không dùng `any` (dùng `Record<string, unknown>`)
- Port PostgreSQL là **5433** (không phải 5432 — bị chiếm bởi project khác)

## Decisions đã chốt
- PostgreSQL port 5433 (5432 bị chiếm bởi `he_thong_zalo-postgres-1`)
- Prisma 5 thay vì 7 (v7 breaking: bỏ `url` trong datasource, cần prisma.config.ts)
- `Record<string, unknown>` thay `any` trong toàn bộ types
- `LoginQRCallbackEventType` import từ root `'zca-js'` (không dùng subpath)
- `zalo.loginQR()` trả về `Promise<API>` trực tiếp — không cần gọi `zalo.login()` sau đó
- `api.sendFriendRequest(msg, userId)` — thứ tự: message trước, userId sau
- `listener.on('closed', ...)` phải xử lý riêng (Zalo kill khi mở session khác)

## Đã hoàn thành
- [x] docker-compose.yml — postgres:5433, redis:6379, healthcheck
- [x] .env — keys generated, DATABASE_URL port 5433
- [x] prisma/schema.prisma — 13 tables, Prisma 5, migration `init` done
- [x] src/types/index.ts — WorkerCommand, WorkerEvent, ZaloCreds, SessionRecord, PoolConfig
- [x] src/workers/zalo.worker.ts — loginQR, loginCookie, listeners, rate limit, heartbeat

## Đang làm
- [ ] src/services/session-pool.service.ts — Prompt 2.3

## Files quan trọng
- `src/types/index.ts` — tất cả shared types
- `prisma/schema.prisma` — DB schema
- `src/workers/zalo.worker.ts` — Zalo child process
- `.env` — DATABASE_URL port 5433, MASTER_KEY, AUDIT_HMAC_KEY đã set

## Desktop files nên tham khảo khi port
- `src/services/zalo/ZaloService.ts` — session management pattern
- `src/services/workflow/WorkflowEngineService.ts` — workflow engine
- `src/services/crm/CRMQueueService.ts` — CRM queue
- `electron/ipc/` — IPC patterns → thay bằng REST/Socket.io

## zca-js quirks (phát hiện thực tế — v2.1.2)
- `loginQR()` trả về `Promise<API>` trực tiếp — không cần bước `login()` riêng
- QR image nằm ở `event.data.image` (không phải `qrDataUrl`)
- `sendFriendRequest(message, userId)` — message TRƯỚC, userId SAU
- `LoginQRCallbackEventType` import từ root `'zca-js'` (không phải subpath)
- `listener.on('disconnected', (code, reason))` — 2 arguments
- `listener.on('closed', ...)` — Zalo kill listener khi session khác mở
