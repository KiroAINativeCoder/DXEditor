import './env.js'
import http from 'http'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { LeveldbPersistence } from 'y-leveldb'
import { verifyToken } from './auth.js'
import { getAccess } from './access.js'
// y-websocket 1.5.4 ships the battle-tested connection handler. Its package
// `exports` map doesn't expose the subpath, so import the file by relative path.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- no type declarations for the bin utils
import { setupWSConnection, setPersistence } from '../node_modules/y-websocket/bin/utils.js'

/**
 * DXEditor collaboration relay.
 *
 * Uses y-websocket's official setupWSConnection (correct Yjs sync + awareness
 * handshake) with LevelDB persistence via setPersistence. We authenticate and
 * authorize on the HTTP upgrade (RLS can't guard the Yjs content layer), then
 * hand the socket to setupWSConnection with the docName = URL path.
 */

const PORT = Number(process.env.COLLAB_PORT ?? 4001)
const DB_DIR = process.env.YJS_DB_DIR ?? './y-leveldb'

const ldb = new LeveldbPersistence(DB_DIR)

setPersistence({
  provider: ldb,
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const persisted = await ldb.getYDoc(docName)
    if (persisted) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persisted))
    ydoc.on('update', (update: Uint8Array) => {
      ldb.storeUpdate(docName, update)
    })
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    await ldb.storeUpdate(docName, Y.encodeStateAsUpdate(ydoc))
  },
})

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('DXEditor collaboration server\n')
})

// noServer: we authenticate on the upgrade before accepting the socket.
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const docName = url.pathname.slice(1) || 'default'
    const token = url.searchParams.get('token') ?? ''

    const session = await verifyToken(token)
    if (!session) {
      console.warn(`[collab] reject ${docName}: unauthenticated`)
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const access = await getAccess(session.id, docName)
    if (!access) {
      console.warn(`[collab] reject ${docName}: user ${session.id} no access`)
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    console.log(`[collab] accept ${docName}: user ${session.id} role=${access.role}`)

    wss.handleUpgrade(req, socket, head, (conn) => {
      // setupWSConnection reads the room name from the URL; pass docName explicitly.
      setupWSConnection(conn, req, { docName, gc: true })
    })
  } catch (err) {
    console.error('[collab] upgrade error:', err)
    try {
      socket.destroy()
    } catch {
      /* already closed */
    }
  }
})

server.listen(PORT, () => {
  console.log(`DXEditor collab (Yjs) listening on ws://localhost:${PORT}`)
})
