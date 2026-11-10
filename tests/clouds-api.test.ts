/** POST /api/clouds 가 DB 에 닿기 전에 걸러 내는 것들. DB 가 필요한 경로는 로컬 wrangler 로 확인한다. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onRequest, onRequestPost } from '../functions/api/clouds.ts'

type Ctx = Parameters<typeof onRequestPost>[0]
const noDb = new Proxy({}, { get: () => assert.fail('DB 에 닿으면 안 된다') })

async function post(body: string, opt: { url?: string; type?: string; origin?: string; env?: Record<string, unknown> } = {}) {
  const request = new Request(opt.url ?? 'https://sky-doodle.pages.dev/api/clouds', {
    method: 'POST',
    headers: { 'content-type': opt.type ?? 'application/json', ...(opt.origin ? { origin: opt.origin } : {}) },
    body,
  })
  const res = await onRequestPost({ request, env: { DB: noDb, ...opt.env }, waitUntil() {} } as unknown as Ctx)
  return { status: res.status, body: (await res.json()) as { error?: string } }
}

const ok = JSON.stringify({ seed: 1, pts: [[1, 2, 3, 4]], nick: '구름' })

test('JSON 이 아니면 415, 너무 크면 413', async () => {
  assert.equal((await post(ok, { type: 'text/plain' })).status, 415)
  assert.equal((await post('x'.repeat(70_000))).status, 413)
})

test('다른 사이트에서 보낸 제출은 403', async () => {
  assert.equal((await post(ok, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await post(ok, { type: 'text/plain; application/json' })).status, 415)
})

test('모양이 틀린 본문은 400', async () => {
  const cases: [string, string][] = [
    ['{', 'bad_json'],
    ['null', 'bad_json'],
    ['"x"', 'bad_json'],
    [JSON.stringify({ seed: -1, pts: [[1, 2]] }), 'bad_seed'],
    [JSON.stringify({ seed: 1.5, pts: [[1, 2]] }), 'bad_seed'],
    [JSON.stringify({ seed: 1, pts: [[1, 2, 3]] }), 'bad_pts'],
    [JSON.stringify({ seed: 1, pts: [[1, 2]], nick: '12345678901' }), 'bad_nick'],
  ]
  for (const [body, code] of cases) assert.deepEqual(await post(body), { status: 400, body: { error: code } }, body)
})

test('운영 주소에서 IP_SALT 가 없으면 저장하지 않고 500', async () => {
  assert.deepEqual(await post(ok), { status: 500, body: { error: 'not_configured' } })
  assert.deepEqual(await post(ok, { env: { IP_SALT: '' } }), { status: 500, body: { error: 'not_configured' } })
})

test('GET·POST 밖의 메서드는 405', async () => {
  const res = await (onRequest as unknown as () => Response)()
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'GET, POST')
})
