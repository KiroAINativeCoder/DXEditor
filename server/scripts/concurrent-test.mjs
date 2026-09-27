/**
 * N-editor concurrent convergence test.
 *
 * Spins up N headless Yjs clients in the SAME room, has them all insert text
 * concurrently (interleaved), then verifies every client converges to the
 * exact same final document — the core CRDT guarantee.
 *
 * Usage:
 *   node concurrent-test.mjs [N] [editsPerClient] [roomName]
 *   node concurrent-test.mjs 10 20
 *
 * Requires the collab relay running:  npm run collab
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'

const URL = process.env.COLLAB_URL ?? 'ws://localhost:4001'
const N = Number(process.argv[2] ?? 5)
const EDITS = Number(process.argv[3] ?? 10)
const ROOM = process.argv[4] ?? `converge-${Date.now()}`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(`Spinning up ${N} editors in room "${ROOM}", ${EDITS} edits each…`)

  const clients = Array.from({ length: N }, (_, i) => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(URL, ROOM, doc, {
      WebSocketPolyfill: WebSocket,
      connect: true,
    })
    return { i, doc, provider, text: doc.getText('body') }
  })

  // Wait for all to connect + initial sync.
  await Promise.all(
    clients.map(
      (c) =>
        new Promise((resolve) => {
          if (c.provider.synced) return resolve()
          c.provider.once('sync', resolve)
          setTimeout(resolve, 3000)
        }),
    ),
  )
  console.log('All connected. Editing concurrently…')

  // Every client inserts its own marker EDITS times, with tiny random delays
  // so the inserts genuinely interleave across clients.
  await Promise.all(
    clients.map(async (c) => {
      for (let k = 0; k < EDITS; k++) {
        await wait(Math.random() * 15)
        const pos = Math.floor(Math.random() * (c.text.length + 1))
        c.text.insert(pos, `[c${c.i}:${k}]`)
      }
    }),
  )

  // Let updates propagate and settle.
  await wait(1500)

  // Convergence check: every client's text must be identical.
  const finals = clients.map((c) => c.text.toString())
  const ref = finals[0]
  const allEqual = finals.every((t) => t === ref)
  const expectedChars = clients.reduce((sum, c) => sum + c.i.toString().length, 0) // sanity only
  void expectedChars

  console.log(`\nFinal length (each client): ${finals.map((t) => t.length).join(', ')}`)
  const totalInserts = N * EDITS
  const markerCount = (ref.match(/\[c\d+:\d+\]/g) ?? []).length
  console.log(`Markers present: ${markerCount} / expected ${totalInserts}`)
  console.log('CONVERGENCE (all clients identical):', allEqual ? 'PASS ✅' : 'FAIL ❌')
  console.log('NO LOST EDITS (all markers present):', markerCount === totalInserts ? 'PASS ✅' : 'FAIL ❌')

  if (!allEqual) {
    // Show where they diverge, for debugging.
    finals.forEach((t, i) => console.log(`  client ${i}: len=${t.length} head="${t.slice(0, 40)}"`))
  }

  clients.forEach((c) => c.provider.destroy())
  await wait(300)

  const ok = allEqual && markerCount === totalInserts
  console.log('\nRESULT:', ok ? 'ALL PASS ✅' : 'FAILED ❌')
  process.exit(ok ? 0 : 1)
}

main()
