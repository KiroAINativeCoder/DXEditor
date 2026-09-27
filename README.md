# DXEditor

A collaborative document editor — a Quip-style clone with rich-text editing and real-time multi-user collaboration.

## Stack

| Layer | Tech |
|-------|------|
| Editor | [Tiptap](https://tiptap.dev) (ProseMirror) |
| Collaboration | [Yjs](https://yjs.dev) + `y-websocket` |
| Frontend | React + Vite + TypeScript |
| Backend | Node (Express) |
| Database | Postgres + Prisma |

## Structure

```
DXEditor/
├── client/   # React + Vite + Tiptap frontend
└── server/   # Node API + y-websocket collaboration relay
```

## Roadmap

- [x] **Phase 0** — Project scaffold, repo setup
- [x] **Phase 1** — Single-user rich-text editor (Tiptap + toolbar)
- [x] **Phase 2** — Persistence (save/load documents via API + Prisma)
- [x] **Phase 3** — Real-time collaboration (Yjs + WebSocket relay)
- [x] **Phase 4a** — Document management (list, create, rename, delete; per-doc rooms)
- [ ] **Phase 4b** — Auth, sharing & permissions
- [ ] **Phase 5** — Presence cursors + comments
- [ ] **Phase 6** — Folders, slash commands, export, search, deploy

## Development

**One-time setup** (installs deps + creates the dev database):

```bash
cd DXEditor
npm run install:all     # root + server + client deps
npm --prefix server exec prisma migrate deploy   # create SQLite dev.db
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**Run everything with one command** (API + collab relay + web client together):

```bash
npm run dev
```

That launches all three, prefixed `[api]` (:4000), `[collab]` (:4001), `[web]` (:5173).
Open http://localhost:5173 — open it in two windows to see live collaboration.

Prefer separate terminals? Run them individually:

```bash
npm --prefix server run dev      # REST API   :4000
npm --prefix server run collab   # Yjs relay  :4001
npm --prefix client run dev      # web client :5173
```

## License

MIT
