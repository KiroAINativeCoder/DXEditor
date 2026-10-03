// Load .env into process.env. Import this FIRST in every entrypoint, before
// any module that reads process.env at construction time (e.g. the Supabase
// clients in server.ts / access.ts).
import 'dotenv/config'
