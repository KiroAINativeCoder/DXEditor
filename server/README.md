# server

Node + Express API with Prisma persistence for DXEditor.

## Setup

```bash
npm install
cp .env.example .env        # SQLite dev DB by default
npx prisma migrate dev      # create the DB + tables
npm run dev                 # http://localhost:4000
```

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
