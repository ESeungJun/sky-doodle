/** 어드민 미들웨어: Access 토큰 검증. 시험용 RSA 키로 토큰을 만들고 키 받아 오기(fetch)를 흉내 낸다. */
import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { onRequest } from '../functions/admin/_middleware.ts'

const DOMAIN = 'team.example.cloudflareaccess.com'
const AUD = 'aud-123'
const env = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD }

const b64 = (data: string | ArrayBuffer) =>
  Buffer.from(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)).toString('base64url')

let keys: CryptoKeyPair
let other: CryptoKeyPair
let certFails = false
let certCalls = 0

before(async () => {
  const gen = () =>
    crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  keys = await gen()
  other = await gen()
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' }
  globalThis.fetch = (async (url: string) => {
    certCalls++
    assert.equal(String(url), `https://${DOMAIN}/cdn-cgi/access/certs`)
    return certFails ? new Response('down', { status: 500 }) : Response.json({ keys: [jwk] })
  }) as typeof fetch
})

async function token(claims: Record<string, unknown>, opt: { kid?: string; alg?: string; key?: CryptoKey } = {}) {
  const head = b64(JSON.stringify({ alg: opt.alg ?? 'RS256', kid: opt.kid ?? 'k1' }))
  const body = b64(JSON.stringify(claims))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opt.key ?? keys.privateKey, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64(sig)}`
}

const good = () => ({ aud: [AUD], exp: Date.now() / 1000 + 300, iss: `https://${DOMAIN}`, email: 'admin@example.com' })

async function call(jwt: string | null, e: Record<string, string> = env, url = 'https://sky.example/admin/api/stats') {
  const data: { who?: string } = {}
  let passed = false
  const ctx = {
    request: new Request(url, { headers: jwt === null ? {} : { 'cf-access-jwt-assertion': jwt } }),
    env: e,
    data,
    next: async () => {
      passed = true
      return new Response('inner')
    },
  }
  const res = await (onRequest as unknown as (c: typeof ctx) => Promise<Response>)(ctx)
  return { status: res.status, passed, who: data.who, cache: res.headers.get('cache-control') }
}

test('맞는 토큰은 통과하고 메일이 남는다', async () => {
  const r = await call(await token(good()))
  assert.deepEqual(r, { status: 200, passed: true, who: 'admin@example.com', cache: 'no-store' })
})

test('토큰이 없으면 403', async () => {
  const r = await call(null)
  assert.equal(r.status, 403)
  assert.equal(r.passed, false)
})

test('Access 설정이 없으면 맞는 토큰도 403', async () => {
  const jwt = await token(good())
  assert.equal((await call(jwt, {})).status, 403)
  assert.equal((await call(jwt, { ACCESS_TEAM_DOMAIN: DOMAIN })).status, 403)
})

test('틀린 토큰은 전부 403 이고 안쪽 핸들러에 닿지 않는다', async () => {
  const now = Date.now() / 1000
  const cases: Record<string, string> = {
    '다른 aud': await token({ ...good(), aud: ['someone-else'] }),
    '만료': await token({ ...good(), exp: now - 10 }),
    'exp 없음': await token({ ...good(), exp: undefined }),
    '아직 유효하지 않음': await token({ ...good(), nbf: now + 600 }),
    '다른 발급자': await token({ ...good(), iss: 'https://evil.example' }),
    '다른 키로 서명': await token(good(), { key: other.privateKey }),
    '모르는 kid': await token(good(), { kid: 'nope' }),
    'alg none': await token(good(), { alg: 'none' }),
    'HS256': await token(good(), { alg: 'HS256' }),
    '내용을 바꿈': (await token(good())).replace(/\.[^.]+\./, `.${b64(JSON.stringify({ ...good(), email: 'x@evil.example' }))}.`),
    '서명 없음': (await token(good())).split('.').slice(0, 2).join('.') + '.',
  }
  for (const [name, jwt] of Object.entries(cases)) {
    const r = await call(jwt)
    assert.equal(r.status, 403, name)
    assert.equal(r.passed, false, name)
  }
})

test('모양이 깨진 토큰은 503 이 아니라 403', async () => {
  for (const jwt of ['zzz', 'abc.def.ghi', '..', `${b64('[1]')}.${b64('{}')}.x`, `${b64('null')}.e30.x`, `%%%.%%%.%%%`]) {
    assert.equal((await call(jwt)).status, 403, jwt)
  }
})

test('로컬 우회는 값이 1 이고 localhost 일 때만', async () => {
  const bypass = { DEV_ADMIN_BYPASS: '1' }
  const local = await call(null, bypass, 'http://localhost:8788/admin/api/stats')
  assert.equal(local.status, 200)
  assert.equal(local.who, 'local-dev')
  assert.equal((await call(null, bypass, 'http://127.0.0.1:8788/admin/')).status, 200)
  assert.equal((await call(null, bypass, 'https://sky-doodle.pages.dev/admin/')).status, 403)
  assert.equal((await call(null, bypass, 'https://localhost.evil.example/admin/')).status, 403)
  assert.equal((await call(null, { DEV_ADMIN_BYPASS: 'true' }, 'http://localhost:8788/admin/')).status, 403)
})

test('키를 받아 오지 못하면 503 (통과시키지 않는다)', async () => {
  // 모르는 kid 는 키를 다시 받아 오게 한다. 다시 받기는 1분에 한 번이라 시계를 2분 뒤로 돌린다
  const jwt = await token(good(), { kid: 'rotated' })
  const realNow = Date.now
  Date.now = () => realNow() + 120_000
  certFails = true
  try {
    const r = await call(jwt)
    assert.equal(r.status, 503)
    assert.equal(r.passed, false)
  } finally {
    certFails = false
    Date.now = realNow
  }
})

test('모르는 kid 로 키 서버를 연달아 두드리지 못한다', async () => {
  const realNow = Date.now
  Date.now = () => realNow() + 300_000
  try {
    const jwt = await token({ ...good(), exp: Date.now() / 1000 + 300 }, { kid: 'nope' })
    await call(jwt)
    const before = certCalls
    for (let i = 0; i < 5; i++) assert.equal((await call(jwt)).status, 403)
    assert.equal(certCalls, before, '1분 안에는 키를 다시 받지 않는다')
  } finally {
    Date.now = realNow
  }
})
