import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanPts, LIMITS } from '../functions/_lib.ts'
import { BASE_W, type Stroke } from '../src/geom.ts'
import { IDLE_AFTER, MAX_COORDS, MAX_STROKES, nextPollDelay, POLL_BASE, POLL_MAX, sharePts, shouldPoll, valid } from '../src/shared.ts'

test('화면이 보내는 한도는 서버가 받는 한도 안이다', () => {
  assert.ok(MAX_COORDS <= LIMITS.maxCoords)
  assert.ok(MAX_STROKES <= LIMITS.maxStrokes)
})

test('sharePts: 왼쪽 위를 원점으로 옮긴 0 이상 정수', () => {
  const s: Stroke = { pts: [{ x: 120.4, y: 80.7 }, { x: 160.2, y: 80.7 }], w: BASE_W }
  const out = sharePts([s])
  assert.deepEqual(out[0].slice(0, 2), [0, 0])
  assert.ok(out.flat().every((n) => Number.isInteger(n) && n >= 0))
})

test('sharePts: 아주 긴 그림도 서버 검증을 통과한다', () => {
  const zig: Stroke = { pts: Array.from({ length: 6000 }, (_, i) => ({ x: (i % 2) * 300 + i * 0.1, y: i * 0.5 })), w: BASE_W }
  const many = Array.from({ length: 120 }, (_, i): Stroke => ({ pts: [{ x: i, y: 0 }, { x: i, y: 40 }], w: 3 }))
  for (const strokes of [[zig], many, [zig, ...many]]) {
    const out = sharePts(strokes)
    assert.ok(out.reduce((n, r) => n + r.length, 0) <= MAX_COORDS)
    assert.ok(out.length <= MAX_STROKES)
    assert.ok(cleanPts(out), '서버 검증(cleanPts)을 통과해야 한다')
  }
})

test('sharePts: 빈 획은 버리고, 아주 큰 좌표는 한도로 자른다', () => {
  const out = sharePts([{ pts: [], w: BASE_W }, { pts: [{ x: 0, y: 0 }, { x: 9000, y: 0 }], w: BASE_W }])
  assert.equal(out.length, 1)
  assert.ok(Math.max(...out[0]) <= LIMITS.maxCoord)
  assert.ok(cleanPts(out))
})

test('nextPollDelay: 새 구름이 없으면 30초 → 60초 → 120초에서 멈춘다', () => {
  assert.equal(nextPollDelay(0), POLL_BASE)
  assert.equal(nextPollDelay(1), 60_000)
  assert.equal(nextPollDelay(2), POLL_MAX)
  assert.equal(nextPollDelay(50), POLL_MAX)
  assert.equal(nextPollDelay(-1), POLL_BASE)
})

test('shouldPoll: 가려졌거나 5분 넘게 조작이 없으면 쉰다', () => {
  assert.ok(shouldPoll(false, 0))
  assert.ok(shouldPoll(false, IDLE_AFTER - 1))
  assert.ok(!shouldPoll(false, IDLE_AFTER))
  assert.ok(!shouldPoll(true, 0))
})

test('valid: 서버 응답 모양 확인', () => {
  assert.ok(valid({ id: 'a', seed: 1, nick: '', pts: [[1, 2]] }))
  assert.ok(!valid(null as never))
  assert.ok(!valid({ id: 'a', seed: 1, nick: '', pts: [['x']] } as never))
  assert.ok(!valid({ id: 1, seed: 1, nick: '', pts: [] } as never))
})
