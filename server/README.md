# server

Node + Express API with Prisma persistence for DXEditor.

## Setup

```bash
npm install
cp .env.example .env        # SQLite dev DB by default
npx prisma migrate dev      # create the DB + tables
npm run dev                 # REST API   → http://localhost:4000
npm run collab              # Yjs relay   → ws://localhost:4001
```

Run the API (`dev`) and the collaboration relay (`collab`) in two terminals.

## Database

Dev uses **SQLite** (`file:./dev.db`, zero setup). To use Postgres:

1. In `prisma/schema.prisma`, set `provider = "postgresql"`.
2. Set `DATABASE_URL` in `.env` to your Postgres connection string.
3. `npx prisma migrate dev`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/api/documents` | List documents (metadata only) |
| GET | `/api/documents/:id` | Get one document (with content) |
| POST | `/api/documents` | Create `{ title?, content? }` |
| PUT | `/api/documents/:id` | Update `{ title?, content? }` |
| DELETE | `/api/documents/:id` | Delete |

`content` is the Tiptap/ProseMirror document JSON (`editor.getJSON()`).

## Collaboration relay (`src/collab.ts`)

A self-contained Yjs WebSocket relay (`npm run collab`, port 4001). Each URL
path is one shared room (`ws://host:4001/<docId>`); clients exchange two
channels — sync (`y-protocols/sync`) and awareness (presence). Room state is
persisted to LevelDB (`y-leveldb`, gitignored `y-leveldb/` dir) so documents
survive restarts. Frames are queued until a room's persisted state loads, so a
client's opening handshake is never dropped during the async load.

