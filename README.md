# DXEditor

A collaborative document editor — a Quip-style clone with rich-text editing and
**real-time multi-user collaboration** (live cursors, presence, conflict-free
concurrent editing).

## Stack

| Layer | Tech |
|-------|------|
| Editor | [Tiptap](https://tiptap.dev) (ProseMirror) |
| Collaboration | [Yjs](https://yjs.dev) CRDT + WebSocket relay (`y-protocols`) |
| Presence | Yjs Awareness + Tiptap `CollaborationCaret` |
| Frontend | React 19 + Vite + TypeScript |
| Backend | Node + Express (REST) + a separate Yjs WebSocket relay |
| Metadata DB | SQLite via Prisma (one-line swap to Postgres) |
| Document store | LevelDB (`y-leveldb`) — the CRDT document state |

## How it works

Two server processes on the backend, one web client:

```
                    ┌─────────────────────────────┐
  Browser  ── REST ─┤ API (:4000)  → SQLite         │  metadata: doc list,
  (React)           │  Express + Prisma             │  titles, owners
     │              └─────────────────────────────┘
     │              ┌─────────────────────────────┐
     └── WebSocket ─┤ Collab relay (:4001) → LevelDB│  content: live Yjs
                    │  Yjs sync + awareness         │  document per room
                    └─────────────────────────────┘
```

- A document's SQLite `id` **is** its Yjs room name — one id links its metadata
  (SQLite) to its content (LevelDB).
- The browser holds a live in-memory replica; edits sync through the relay and
  persist to LevelDB. Presence (cursors/names) rides a separate channel and is
  never saved.

## Project structure

```
DXEditor/
├── package.json        # root — one-command dev launcher (concurrently)
├── client/             # React + Vite + Tiptap frontend
│   └── src/
│       ├── App.tsx             # sidebar + editor layout, doc selection
│       ├── components/
│       │   ├── Sidebar.tsx     # document list: create / select / delete
│       │   ├── Editor.tsx      # Tiptap + Yjs collab editor, presence
│       │   └── Toolbar.tsx     # formatting controls
│       └── lib/
│           ├── api.ts          # REST client
│           └── identity.ts     # random presence name + color
└── server/
    ├── src/
    │   ├── server.ts   # Express REST API (documents CRUD)
    │   ├── collab.ts   # Yjs WebSocket relay + LevelDB persistence
    │   └── db.ts       # Prisma client
    └── prisma/
        └── schema.prisma
```

## Prerequisites

- **Node.js 20+**
- npm

No external database needed — dev uses SQLite (a local file).

## Setup (one time)

```bash
cd DXEditor

# 1. Install all dependencies (root + server + client)
npm run install:all

# 2. Create the local dev database + tables
npm --prefix server exec prisma migrate deploy

# 3. Create env files from the examples
cp server/.env.example server/.env    # set JWT_SECRET for real deployments
cp client/.env.example client/.env
```

On first run, **sign up** with an email + password. Documents are private to their
owner; use the **Share** button (owner only) to grant another registered user
**Can edit** or **Can view** access by email. Roles are enforced on both the REST
API and the collaboration WebSocket (a viewer's edits are rejected server-side).

## Run

**One command — starts all three processes together:**

```bash
npm run dev
```

Output is prefixed per process:
- `[api]`    → REST API on http://localhost:4000
- `[collab]` → Yjs relay on ws://localhost:4001
- `[web]`    → web client on http://localhost:5173

Then open **http://localhost:5173**.

**To see live collaboration:** open that URL in **two browser windows** side by
side. Create a document in the sidebar, type in one window — the text and the
other person's colored cursor appear live in the other.

### Or run each process in its own terminal

```bash
npm --prefix server run dev      # REST API   → :4000
npm --prefix server run collab   # Yjs relay  → :4001
npm --prefix client run dev      # web client → :5173
```

## Verifying it's running

| Check | Expected |
|-------|----------|
| `curl http://localhost:4000/health` | `{"ok":true}` |
| `curl http://localhost:4001/` | `DXEditor collaboration server` |
| Status pill (bottom-right of editor) | **Live · N people here** |

**Troubleshooting the status pill:**
- *Connecting… / Disconnected* → the collab relay (:4001) isn't running.
- *Sidebar says "Could not reach the API"* → the REST API (:4000) isn't running.
- *`The table 'Document' does not exist`* → run `npm --prefix server exec prisma migrate deploy`.

## Tests

Concurrent-editing convergence test (N headless editors on one doc; requires the
relay running):

```bash
npm --prefix server run collab                    # in one terminal
npm --prefix server run test:concurrent 5 10      # 5 editors, 10 edits each
```

## Switching to Postgres

1. In `server/prisma/schema.prisma`, set `provider = "postgresql"`.
2. Set `DATABASE_URL` in `server/.env` to your Postgres connection string.
3. `npm --prefix server exec prisma migrate dev`.

## Roadmap

- [x] **Phase 0** — Project scaffold, repo setup
- [x] **Phase 1** — Single-user rich-text editor (Tiptap + toolbar)
- [x] **Phase 2** — Persistence (documents via REST API + Prisma)
- [x] **Phase 3** — Real-time collaboration (Yjs + WebSocket relay + presence)
- [x] **Phase 4a** — Document management (list, create, rename, delete; per-doc rooms)
- [x] **Phase 4b** — Auth (email/password + JWT cookie), sharing by email, viewer/editor roles enforced on REST + WebSocket
- [ ] **Phase 5** — Comments
- [ ] **Phase 6** — Folders, slash commands, export, full-text search, deploy

## License

MIT
