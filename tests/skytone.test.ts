import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitScale } from '../src/geom.ts'
import { daySeed, skyAt } from '../src/skytone.ts'

test('skyAt: 한낮은 처음 만든 하늘 색 그대로, 별 없음', () => {
  const noon = skyAt(12)
  assert.deepEqual(noon.stops, ['#1f6fd1', '#4fa3ec', '#9fd5fb', '#d9f0ff'])
  assert.equal(noon.stars, 0)
  assert.equal(noon.dusk, 0)
  assert.equal(noon.moon, false)
})

test('skyAt: 밤에는 달과 별', () => {
  const night = skyAt(1)
  assert.equal(night.moon, true)
  assert.equal(night.stars, 1)
  assert.deepEqual(skyAt(23.5), night)
})

test('skyAt: 자정을 넘어도, 범위를 벗어난 시각도 이어진다', () => {
  assert.deepEqual(skyAt(24), skyAt(0))
  assert.deepEqual(skyAt(-1), skyAt(23))
  assert.deepEqual(skyAt(36), skyAt(12))
})

test('skyAt: 하루 내내 색이 튀지 않는다(6분 사이 채널 변화 20 이하)', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let h = 0; h < 24; h += 0.1) {
    const a = skyAt(h)
    const b = skyAt(h + 0.1)
    for (let k = 0; k < 4; k++) {
      assert.match(a.stops[k], /^#[0-9a-f]{6}$/)
      const d = Math.max(...rgb(a.stops[k]).map((v, i) => Math.abs(v - rgb(b.stops[k])[i])))
      assert.ok(d <= 20, `${h.toFixed(1)}시 ${k}번째 색이 ${d} 만큼 튄다`)
    }
  }
})

test('daySeed: 같은 날은 같고 다음 날은 다르다', () => {
  assert.equal(daySeed(new Date(2026, 10, 10, 1)), daySeed(new Date(2026, 10, 10, 23)))
  assert.notEqual(daySeed(new Date(2026, 10, 10)), daySeed(new Date(2026, 10, 11)))
})

test('fitScale: 구름이 그림 안에 들어오는 배율', () => {
  assert.equal(fitScale(100, 50, 1000, 0.5), 5)
  assert.equal(fitScale(50, 100, 1000, 0.5), 5)
  assert.ok(Number.isFinite(fitScale(0, 0, 1080)))
})
