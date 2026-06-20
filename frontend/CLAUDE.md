@AGENTS.md

# Frontend handoff - Deplao Web

Cap nhat cuoi ngay 19/06/2026. File nay giu dong `@AGENTS.md` o tren cung de Claude/agent doc rule Next.js rieng cua frontend truoc khi code.

## Stack thuc te

- Next.js 16.2.9 App Router.
- React 19.
- Tailwind CSS 4.
- Zustand 5.
- socket.io-client 4.
- Axios API client.
- Port dev mac dinh: `http://localhost:3000`.
- Backend API/WebSocket: `http://localhost:3001`, namespace `/zalo`.

## Trang thai hien tai

DONE core:

- Login/register pages.
- Dashboard layout.
- Accounts page va QR modal.
- Socket client auto-connect sau login.
- Accounts store, auth store, chat stores.
- Inbox co ban va socket listeners.

DANG DO:

- Dang port inbox/chat UI kieu desktop sang web.
- `app/(dashboard)/inbox/page.tsx` da tach sang dung `ConversationList` va `ChatWindow`.
- Cac component chat copy tu desktop co the chua build sach vi con import alias/store cu.

## Stores can nho

- `frontend/stores/chatStore.ts` la store chinh, desktop-compatible, dung cho cac component chat moi port.
- `frontend/stores/chat.store.ts` chi la backward-compat re-export.
- Khi viet code moi cho chat, uu tien import tu `@/stores/chatStore`.

## Component/chat files dang port

- `frontend/components/chat/ConversationList.tsx`
- `frontend/components/chat/ChatWindow.tsx`
- `frontend/components/chat/ChatHeader.tsx`
- `frontend/components/chat/ChatHistoryList.tsx`
- `frontend/components/chat/MessageBubbles.tsx`
- `frontend/components/chat/MessageInput.tsx`
- `frontend/components/common/UserProfilePopup.tsx`

Luu y: cac file copy tu desktop co the con import kieu:

- `@/store/*` trong khi frontend hien co `@/stores/*`.
- module desktop chua ton tai trong frontend.
- helper trong `@/lib/*`, `@/hooks/*`, `@/utils/*` can doi chieu file that co trong frontend.

Fix build/import truoc khi coi inbox desktop-style la DONE.

## API message moi can test

- `GET /api/messages/threads`
- `GET /api/messages/:threadId?limit=50`
- `GET /api/messages/:threadId?limit=50&before=<iso-date>`
- `PATCH /api/messages/:threadId/read`

`frontend/lib/api-client.ts` da co `patch()`.
`frontend/lib/ipc.ts` da co bridge tam cho `db.getThreads`, `db.getMessages`, `db.markAsRead`.

## Commands ngay mai

Tu root repo:

```bash
docker compose up -d
```

Backend:

```bash
cd backend
npm run start:dev
```

Frontend:

```bash
cd frontend
npm run dev
npm run build
```

## Thu tu lam tiep

1. Chay backend va frontend.
2. Chay `cd frontend && npm run build`.
3. Fix cac loi import/type cua component chat copy tu desktop.
4. Test API message threads/messages/read.
5. Test inbox real-time voi account Zalo that.
6. Sau khi inbox on dinh moi quay lai Deploy hoac Campaign Manager.

## Known issue

- `DELETE /api/accounts/:id` voi UUID sai format co the tra 500 thay vi 404 vi backend chua map `PrismaClientValidationError` dung cach.
