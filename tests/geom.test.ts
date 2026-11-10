import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_W, bounds, flatten, girth, layoutCloud, MAX_PUFFS, nearStroke, PointerGate, puffsFromStrokes, resample, rng, sharedScale, toStrokes, type Stroke } from '../src/geom.ts'

const line = (x0: number, y0: number, x1: number, y1: number, w = BASE_W): Stroke => ({ pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }], w })

test('rng: 같은 시드는 같은 수열, 0 이상 1 미만', () => {
  const a = rng(42)
  const b = rng(42)
  for (let i = 0; i < 50; i++) {
    const v = a()
    assert.equal(v, b())
    assert.ok(v >= 0 && v < 1)
  }
  assert.notEqual(rng(1)(), rng(2)())
  assert.ok(Number.isFinite(rng(0)()))
})

test('resample: 일정 간격으로 다시 뽑는다', () => {
  const pts = resample([[{ x: 0, y: 0 }, { x: 100, y: 0 }]], 10)
  assert.equal(pts.length, 11)
  assert.deepEqual(pts[3], { x: 30, y: 0 })
  // 꺾인 선에서도 간격이 이어진다
  const bent = resample([[{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }]], 10)
  assert.deepEqual(bent.map((p) => [p.x, p.y]), [[0, 0], [10, 0], [15, 5], [15, 15]])
})

test('resample: 빈 선·점 하나·같은 점이 겹친 선', () => {
  assert.deepEqual(resample([[]], 5), [])
  assert.deepEqual(resample([[{ x: 3, y: 4 }]], 5), [{ x: 3, y: 4 }])
  assert.deepEqual(resample([[{ x: 3, y: 4 }, { x: 3, y: 4 }]], 5), [{ x: 3, y: 4 }])
})

test('layoutCloud: 그림 가운데가 원점이고 같은 시드면 같은 구름', () => {
  const strokes = [line(100, 50, 300, 50), line(200, 0, 200, 100)]
  const a = layoutCloud(strokes, 7)
  // 다시 뽑은 점들의 가운데라 끝점 간격만큼은 어긋날 수 있다
  assert.ok(Math.abs(a.cx - 200) <= 3 && Math.abs(a.cy - 50) <= 3, `${a.cx},${a.cy}`)
  assert.deepEqual(a, layoutCloud(strokes, 7))
  assert.notDeepEqual(a.puffs, layoutCloud(strokes, 8).puffs)
  const b = bounds(a.puffs)
  assert.ok(Math.abs(b.minX + b.maxX) < 60, '좌우가 가운데를 기준으로 놓인다')
})

test('layoutCloud: 빈 입력과 덩어리 수 상한', () => {
  assert.deepEqual(layoutCloud([], 1), { puffs: [], cx: 0, cy: 0 })
  assert.deepEqual(puffsFromStrokes([{ pts: [], w: BASE_W }], 1), [])
  const long: Stroke = { pts: Array.from({ length: 4000 }, (_, i) => ({ x: (i % 400) * 5, y: Math.floor(i / 400) * 30 })), w: BASE_W }
  const puffs = puffsFromStrokes([long], 3)
  assert.ok(puffs.length > 100 && puffs.length <= MAX_PUFFS, String(puffs.length))
  assert.ok(puffs.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.r > 0))
})

test('layoutCloud: 굵은 붓은 굵은 구름, 기본 굵기는 배율 1', () => {
  assert.equal(girth(BASE_W), 1)
  assert.ok(girth(3) < 1 && girth(9) > 1)
  assert.ok(girth(1000) <= 1.8 && girth(0.01) >= 0.6)
  const avg = (w: number) => {
    const p = puffsFromStrokes([line(0, 0, 200, 0, w)], 5)
    return p.reduce((n, q) => n + q.r, 0) / p.length
  }
  assert.ok(avg(3) < avg(5) && avg(5) < avg(9))
  assert.ok(Math.abs(avg(9) / avg(5) - girth(9)) < 1e-9)
})

test('nearStroke: 지우개가 닿은 획만 고른다', () => {
  const s = line(0, 0, 100, 0)
  assert.ok(nearStroke(s, { x: 50, y: 8 }, 9))
  assert.ok(!nearStroke(s, { x: 50, y: 20 }, 9))
  assert.ok(nearStroke(s, { x: 108, y: 0 }, 9), '끝점 둘레')
  assert.ok(!nearStroke(s, { x: 130, y: 0 }, 9))
  assert.ok(nearStroke({ pts: [{ x: 5, y: 5 }], w: 5 }, { x: 9, y: 9 }, 9), '점 하나짜리 획')
  assert.ok(nearStroke(line(0, 0, 100, 0, 9), { x: 50, y: 13 }, 9), '굵은 획은 더 멀리서도 닿는다')
})

test('flatten ↔ toStrokes: 저장했다가 다시 읽어도 같은 선', () => {
  const strokes = [line(10, 20, 30, 20, 3), line(5, 5, 5, 25, 9)]
  const flat = flatten(strokes, 4)
  assert.ok(flat.every((row) => row.length % 2 === 0 && row.every(Number.isInteger)))
  const back = toStrokes(flat, strokes.map((s) => s.w))
  assert.deepEqual(back.map((s) => s.w), [3, 9])
  assert.deepEqual(back[0].pts[0], { x: 10, y: 20 })
  assert.deepEqual(flatten(strokes, 4, 5, 5)[0].slice(0, 2), [5, 15], '원점을 옮길 수 있다')
})

test('toStrokes: 굵기가 없거나 이상하면 기본 굵기, 숫자가 아닌 좌표는 0', () => {
  assert.equal(toStrokes([[1, 2]])[0].w, BASE_W)
  assert.deepEqual(toStrokes([[1, 2], [3, 4]], [9, -1]).map((s) => s.w), [9, BASE_W])
  assert.deepEqual(toStrokes([[1, 2]], ['x' as unknown as number])[0].w, BASE_W)
  assert.deepEqual(toStrokes([['a' as unknown as number, 2, 3]])[0].pts, [{ x: 0, y: 2 }])
})

test('PointerGate: 두 번째 손가락은 무시한다', () => {
  const g = new PointerGate()
  assert.equal(g.down(1, 'touch'), 'start')
  assert.equal(g.down(2, 'touch'), 'ignore')
  assert.ok(g.owns(1) && !g.owns(2))
  assert.equal(g.up(2), false, '무시된 손가락이 떨어져도 그리던 선은 끝나지 않는다')
  assert.ok(g.active)
  assert.equal(g.up(1), true)
  assert.ok(!g.active)
  assert.equal(g.down(2, 'touch'), 'start', '다 떨어진 뒤에는 다시 그릴 수 있다')
})

test('PointerGate: 펜은 손(터치)을 밀어내고, 펜끼리·마우스는 밀어내지 않는다', () => {
  const g = new PointerGate()
  g.down(1, 'touch') // 손바닥
  assert.equal(g.down(2, 'pen'), 'takeover')
  assert.ok(g.owns(2) && !g.owns(1))
  assert.equal(g.down(3, 'touch'), 'ignore')
  assert.equal(g.down(4, 'pen'), 'ignore')
  assert.equal(g.up(1), false)
  g.reset()
  g.down(5, 'mouse')
  assert.equal(g.down(6, 'touch'), 'ignore')
})

test('sharedScale: 작은 그림은 그대로, 큰 그림은 긴 변 260px 로 줄인다', () => {
  assert.equal(sharedScale([line(0, 0, 100, 50)]), 1.15)
  assert.equal(sharedScale([line(0, 0, 520, 50)]), 1.15 / 2)
  assert.equal(sharedScale([]), 1.15)
})

test('toStrokes: 손상된 저장분(배열이 아닌 획)은 빈 획으로 읽는다', () => {
  const out = toStrokes([null as unknown as number[], [1, 2]])
  assert.deepEqual(out[0].pts, [])
  assert.deepEqual(out[1].pts, [{ x: 1, y: 2 }])
})
