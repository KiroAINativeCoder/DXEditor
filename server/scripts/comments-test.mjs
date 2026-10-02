// Comments E2E: run against a live API on :4000.
const B = 'http://localhost:4000'

// tiny cookie-jar fetch wrapper
function makeClient() {
  let cookie = ''
  return async (method, path, body) => {
    const res = await fetch(B + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const sc = res.headers.get('set-cookie')
    if (sc) cookie = sc.split(';')[0]
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : undefined } catch { data = text }
    return { status: res.status, data }
  }
}

const results = []
function check(name, cond) {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
}

async function main() {
  const A = makeClient(), Bob = makeClient(), C = makeClient()
  await A('POST', '/api/auth/register', { email: 'a@x.com', password: 'secret1', name: 'Alice' })
  await Bob('POST', '/api/auth/register', { email: 'b@x.com', password: 'secret1', name: 'Bob' })
  await C('POST', '/api/auth/register', { email: 'c@x.com', password: 'secret1' })

  const doc = await A('POST', '/api/documents', { title: 'Doc' })
  const did = doc.data.id

  const thread = await A('POST', `/api/documents/${did}/comments`, {
    body: 'First comment', anchorId: 'anc-1', quote: 'some text',
  })
  check('create thread → 201', thread.status === 201)
  const cid = thread.data.id

  const reply = await A('POST', `/api/documents/${did}/comments`, { body: 'A reply', parentId: cid })
  check('create reply → 201', reply.status === 201)

  const list = await A('GET', `/api/documents/${did}/comments`)
  check('list: 1 thread', list.data.length === 1)
  check('list: 1 reply nested', list.data[0].replies.length === 1)
  check('list: anchorId preserved', list.data[0].anchorId === 'anc-1')
  check('list: quote preserved', list.data[0].quote === 'some text')
  check('reply has no anchor', list.data[0].replies[0].anchorId === null)

  const cNoAccess = await C('GET', `/api/documents/${did}/comments`)
  check('stranger list → 404', cNoAccess.status === 404)

  await A('POST', `/api/documents/${did}/shares`, { email: 'b@x.com', role: 'VIEWER' })
  const bComment = await Bob('POST', `/api/documents/${did}/comments`, { body: 'viewer comment' })
  check('viewer create → 403', bComment.status === 403)
  const bList = await Bob('GET', `/api/documents/${did}/comments`)
  check('viewer CAN list → 200', bList.status === 200)

  const resolved = await A('PATCH', `/api/documents/${did}/comments/${cid}`, { resolved: true })
  check('resolve → resolved:true', resolved.data.resolved === true)

  const del = await A('DELETE', `/api/documents/${did}/comments/${cid}`)
  check('delete → 204', del.status === 204)
  const after = await A('GET', `/api/documents/${did}/comments`)
  check('after delete: 0 threads (cascade)', after.data.length === 0)

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${failed.length === 0 ? 'ALL PASS ✅' : failed.length + ' FAILED ❌'}`)
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
