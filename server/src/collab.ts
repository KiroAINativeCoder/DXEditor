import './env.js'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { LeveldbPersistence } from 'y-leveldb'
import { verifyToken } from './auth.js'
import { getAccess, canEdit } from './access.js'

/**
 * Self-contained Yjs collaboration relay (yjs 13 line).
 *
 * Each WebSocket path (`ws://host:PORT/<docId>`) is one shared room.
 * Envelope: first varUint is the message channel:
 *   0 = sync      (y-protocols/sync — document updates)
 *   1 = awareness (y-protocols/awareness — presence: cursors, names, colors)
 * Room state persists to LevelDB so it survives restarts.
 *
 * The message handler is attached SYNCHRONOUSLY on connect and queues frames
 * until the room's persisted state has loaded — otherwise a client's opening
 * syncStep1 can arrive during the async load and be dropped.
 */

const PORT = Number(process.env.COLLAB_PORT ?? 4001)
const DB_DIR = process.env.YJS_DB_DIR ?? './y-leveldb'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const ldb = new LeveldbPersistence(DB_DIR)

class Room {
  name: string
  doc = new Y.Doc()
  awareness = new awarenessProtocol.Awareness(this.doc)
  conns = new Set<WebSocket>()
  loaded: Promise<void>

  constructor(name: string) {
    this.name = name
    this.awareness.setLocalState(null)

    this.loaded = ldb
      .getYDoc(name)
      .then((persisted) => {
        // getYDoc can return null / throw if LevelDB had trouble; only seed
        // when we actually got a doc. A failure here must NOT reject `loaded`,
        // or the connection's room.loaded.then(sendSyncStep1) never runs and
        // the client never receives the document (blank content).
        if (persisted) {
          Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(persisted))
        }
      })
      .catch((err) => {
        console.error(`[collab] load failed for room ${name} (continuing empty):`, err)
      })
      .finally(() => {
        // Persist + broadcast every future update — registered regardless of
        // whether the initial load succeeded.
        this.doc.on('update', (update: Uint8Array, origin: unknown) => {
          ldb.storeUpdate(name, update)
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MESSAGE_SYNC)
          syncProtocol.writeUpdate(enc, update)
          this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null)
        })
      })

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = added.concat(updated, removed)
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        )
        this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null)
      },
    )
  }

  broadcast(message: Uint8Array, except: WebSocket | null) {
    this.conns.forEach((conn) => {
      if (conn !== except && conn.readyState === WebSocket.OPEN) conn.send(message)
    })
  }
}

const rooms = new Map<string, Room>()

function getRoom(name: string): Room {
  let room = rooms.get(name)
  if (!room) {
    room = new Room(name)
    rooms.set(name, room)
  }
  return room
}

const SYNC_STEP1 = 0
const SYNC_STEP2 = 1
const SYNC_UPDATE = 2

function handleMessage(room: Room, conn: WebSocket, data: Uint8Array, canWrite: boolean) {
  const dec = decoding.createDecoder(data)
  const channel = decoding.readVarUint(dec)

  if (channel === MESSAGE_SYNC) {
    // Peek the sync subtype. A read-only (viewer) client may still complete
    // the handshake (step1/step2 — it needs to RECEIVE the doc) but its own
    // document writes (step2 replies carrying data, and update messages) are
    // dropped so it cannot mutate the shared doc.
    const syncType = decoding.readVarUint(dec)
    if (!canWrite && (syncType === SYNC_UPDATE || syncType === SYNC_STEP2)) {
      return // silently ignore a viewer's attempted write
    }
    // Re-decode from the start so readSyncMessage sees the full sync frame.
    const full = decoding.createDecoder(data)
    decoding.readVarUint(full) // consume the channel byte
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.readSyncMessage(full, enc, room.doc, conn)
    if (encoding.length(enc) > 1) conn.send(encoding.toUint8Array(enc))
  } else if (channel === MESSAGE_AWARENESS) {
    // Presence is allowed for everyone (viewers show a cursor too).
    awarenessProtocol.applyAwarenessUpdate(
      room.awareness,
      decoding.readVarUint8Array(dec),
      conn,
    )
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('DXEditor collaboration server\n')
})

const wss = new WebSocketServer({ server })

wss.on('connection', async (conn: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const docName = url.pathname.slice(1) || 'default'
  const token = url.searchParams.get('token') ?? ''

  try {
    // Authenticate: valid session token required.
    const session = await verifyToken(token)
    if (!session) {
      console.warn(`[collab] reject ${docName}: unauthenticated (token ${token ? 'present-but-invalid' : 'missing'})`)
      conn.close(4001, 'unauthenticated')
      return
    }
    // Authorize: the user must own or be a member of this document.
    const access = await getAccess(session.id, docName)
    if (!access) {
      console.warn(`[collab] reject ${docName}: user ${session.id} has no access`)
      conn.close(4003, 'forbidden')
      return
    }
    const canWrite = canEdit(access)
    console.log(`[collab] accept ${docName}: user ${session.id} role=${access.role} canWrite=${canWrite}`)

    await attachConnection(conn, docName, canWrite)
  } catch (err) {
    // A transient failure (e.g. the Supabase access query errored) must NOT
    // leave the socket half-open — that causes the client to reconnect in a
    // loop. Close explicitly with a distinct code and log the cause.
    console.error(`[collab] error on connect ${docName}:`, err)
    try {
      conn.close(4500, 'server error')
    } catch {
      /* already closing */
    }
  }
})

async function attachConnection(conn: WebSocket, docName: string, canWrite: boolean) {
  const room = getRoom(docName)
  conn.binaryType = 'arraybuffer'
  room.conns.add(conn)

  // Queue frames that arrive before the room finishes loading.
  const queue: Uint8Array[] = []
  let ready = false
  conn.on('message', (data: ArrayBuffer) => {
    const bytes = new Uint8Array(data)
    if (ready) handleMessage(room, conn, bytes, canWrite)
    else queue.push(bytes)
  })

  const cleanup = async () => {
    room.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(room.awareness, [room.doc.clientID], conn)
    if (room.conns.size === 0) {
      await ldb.storeUpdate(room.name, Y.encodeStateAsUpdate(room.doc))
      if (room.conns.size === 0) {
        room.doc.destroy()
        rooms.delete(room.name)
      }
    }
  }
  conn.on('close', cleanup)
  conn.on('error', cleanup)

  room.loaded.then(() => {
    // Kick off the sync handshake: send our state vector (syncStep1).
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    conn.send(encoding.toUint8Array(enc))

    // Send current awareness to the newcomer.
    const states = room.awareness.getStates()
    if (states.size > 0) {
      const aenc = encoding.createEncoder()
      encoding.writeVarUint(aenc, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        aenc,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      )
      conn.send(encoding.toUint8Array(aenc))
    }

    // Drain anything that arrived during load, then go live.
    ready = true
    for (const bytes of queue) handleMessage(room, conn, bytes, canWrite)
    queue.length = 0
  })
}

server.listen(PORT, () => {
  console.log(`DXEditor collab (Yjs) listening on ws://localhost:${PORT}`)
})
