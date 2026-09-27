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
- [ ] **Phase 1** — Single-user rich-text editor (Tiptap + toolbar)
- [ ] **Phase 2** — Persistence (save/load documents via API + Postgres)
- [ ] **Phase 3** — Real-time collaboration (Yjs + y-websocket)
- [ ] **Phase 4** — Auth, document list, sharing & permissions
- [ ] **Phase 5** — Presence cursors + comments
- [ ] **Phase 6** — Folders, slash commands, export, search, deploy

## Development

```bash
# frontend
cd client && npm install && npm run dev

# backend
cd server && npm install && npm run dev
```

## License

MIT
