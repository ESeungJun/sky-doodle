import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanNick, cleanPts, crossSite, ipKey, isJson, json, LIMITS, readBody } from '../functions/_lib.ts'

test('cleanPts: 정상 선은 그대로 돌려준다', () => {
  assert.deepEqual(cleanPts([[1, 2, 30, 40], [0, 0]]), [[1, 2, 30, 40], [0, 0]])
})

test('cleanPts: 모양이 틀린 입력은 null', () => {
  for (const bad of [null, 'x', {}, [], [[]], [[1]], [[1, 2, 3]], [[1, 2.5]], [[-1, 2]], [[1, LIMITS.maxCoord + 1]], [['1', 2]], [[1, NaN]], [1, 2]]) {
    assert.equal(cleanPts(bad), null, JSON.stringify(bad))
  }
})

test('cleanPts: 획 수와 좌표 수 한도', () => {
  const dot = [1, 1]
  assert.ok(cleanPts(Array.from({ length: LIMITS.maxStrokes }, () => dot)))
  assert.equal(cleanPts(Array.from({ length: LIMITS.maxStrokes + 1 }, () => dot)), null)
  assert.ok(cleanPts([Array<number>(LIMITS.maxCoords).fill(5)]))
  assert.equal(cleanPts([Array<number>(LIMITS.maxCoords).fill(5), dot]), null)
  assert.ok(cleanPts([[0, LIMITS.maxCoord]]))
})

test('cleanNick: 없으면 빈 이름, 앞뒤 공백·제어문자 제거', () => {
  assert.equal(cleanNick(undefined), '')
  assert.equal(cleanNick(null), '')
  assert.equal(cleanNick('  구름이 \n'), '구름이')
  assert.equal(cleanNick('a​b‮c'), 'abc')
  assert.equal(cleanNick(12), null)
})

test('cleanNick: 10글자까지(이모지도 한 글자로 센다)', () => {
  assert.equal(cleanNick('1234567890'), '1234567890')
  assert.equal(cleanNick('12345678901'), null)
  assert.equal(cleanNick('☁️'.repeat(5)), '☁️'.repeat(5))
  assert.equal(cleanNick('가'.repeat(11)), null)
})

test('ipKey: IPv4 는 주소 전체', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9')
  assert.notEqual(ipKey('203.0.113.9'), ipKey('203.0.113.10'))
  assert.equal(ipKey(''), 'unknown')
})

test('ipKey: IPv6 는 앞 64비트로 묶는다', () => {
  const a = ipKey('2001:db8:1:2::1')
  assert.equal(a, '2001:db8:1:2::/64')
  assert.equal(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), a)
  assert.equal(ipKey('2001:0DB8:0001:0002:0000:0000:0000:0008'), a)
  assert.equal(ipKey('[2001:db8:1:2::8]'), a)
  assert.notEqual(ipKey('2001:db8:1:3::1'), a)
  assert.equal(ipKey('::1'), '0:0:0:0::/64')
  assert.equal(ipKey('fe80::1%en0'), 'fe80:0:0:0::/64')
})

test('ipKey: IPv4 를 감싼 IPv6 는 IPv4 로 센다', () => {
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9')
  assert.notEqual(ipKey('::ffff:203.0.113.9'), ipKey('::ffff:203.0.113.10'))
})

test('ipKey: 모양이 틀린 주소도 던지지 않고 그대로 키로 쓴다', () => {
  for (const odd of ['1::2::3', 'zz::1', '1:2:3', '1:2:3:4:5:6:7:8:9']) assert.equal(ipKey(odd), odd)
})

test('readBody: 한도 안이면 글, 넘으면 null', async () => {
  const req = (body: string, headers: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', body, headers })
  assert.equal(await readBody(req('{"a":1}'), 100), '{"a":1}')
  assert.equal(await readBody(req('가'.repeat(10)), 30), '가'.repeat(10))
  assert.equal(await readBody(req('x'.repeat(101)), 100), null)
  assert.equal(await readBody(req('ok', { 'content-length': '999999' }), 100), null)
})

test('readBody: 길이 헤더 없이 흘려보내는 큰 본문은 한도에서 끊는다', async () => {
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      sent++
      c.enqueue(new Uint8Array(1024))
    },
  })
  const req = new Request('http://x/', { method: 'POST', body, duplex: 'half' } as RequestInit)
  assert.equal(await readBody(req, 4096), null)
  assert.ok(sent < 20, `한도를 넘은 뒤에도 계속 읽었다: ${sent}`)
})

test('json: nosniff 와 no-store 가 붙고, 덮어쓸 수 있다', () => {
  const res = json({ a: 1 })
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(json({}, 200, { 'cache-control': 'public, max-age=30' }).headers.get('cache-control'), 'public, max-age=30')
})

test('isJson: 정확히 application/json 만', () => {
  const req = (type?: string) => new Request('https://x/', { method: 'POST', body: '{}', headers: type ? { 'content-type': type } : {} })
  assert.ok(isJson(req('application/json')))
  assert.ok(isJson(req('Application/JSON; charset=utf-8')))
  assert.ok(!isJson(req('text/plain; application/json')), '사전 요청 없이 보낼 수 있는 흉내')
  assert.ok(!isJson(req('text/plain')))
})

test('crossSite: Origin 이 다른 요청만', () => {
  const req = (origin?: string) => new Request('https://sky.example/api/clouds', { method: 'POST', headers: origin ? { origin } : {} })
  assert.ok(!crossSite(req()))
  assert.ok(!crossSite(req('https://sky.example')))
  assert.ok(crossSite(req('https://evil.example')))
  assert.ok(crossSite(req('null')))
})
