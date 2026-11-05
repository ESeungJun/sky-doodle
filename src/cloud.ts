import type { Pt, Stroke } from './pad'

export type Puff = { x: number; y: number; r: number }

const SPRITE = 128

/** 구름 덩어리 한 개 모양(몸통·그림자)을 미리 그려 둔 스프라이트. 매 퍼프마다 그라디언트를 만들지 않으려고. */
function makeSprite(paint: (g: CanvasRenderingContext2D, c: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = SPRITE
  const g = cv.getContext('2d')!
  paint(g, SPRITE / 2)
  return cv
}

const BODY = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c * 0.82, c * 0.7, c * 0.05, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.97)')
  grad.addColorStop(0.8, 'rgba(244,248,255,0.75)')
  grad.addColorStop(1, 'rgba(236,243,252,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

const SHADE = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(150,172,204,0.55)')
  grad.addColorStop(0.6, 'rgba(160,182,212,0.3)')
  grad.addColorStop(1, 'rgba(170,190,218,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

const GLOW = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

/** 작은 난수 생성기(시드 고정: 저장된 구름을 다시 만들 때 같은 모양이 되게). */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/** 선을 일정 간격 점으로 다시 뽑는다. */
export function resample(strokes: Stroke[], spacing: number): Pt[] {
  const out: Pt[] = []
  for (const s of strokes) {
    if (s.length === 0) continue
    out.push(s[0])
    let carry = 0
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]
      const b = s[i]
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      let t = spacing - carry
      while (t <= d) {
        out.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d })
        t += spacing
      }
      carry = (carry + d) % spacing
    }
  }
  return out
}

const MAX_PUFFS = 520

/** 선 모양을 따라 뭉게구름 덩어리를 배치한다. 반환 좌표는 그림의 가운데가 (0,0). */
export function puffsFromStrokes(strokes: Stroke[], seed: number, scale = 1.15): Puff[] {
  let total = 0
  for (const s of strokes) for (let i = 1; i < s.length; i++) total += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
  const spacing = Math.max(6, total / (MAX_PUFFS / 1.6))
  const pts = resample(strokes, spacing)
  if (pts.length === 0) return []

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const rand = rng(seed)
  const base = 13 * scale
  const puffs: Puff[] = []
  pts.forEach((p, i) => {
    const x = (p.x - cx) * scale
    const y = (p.y - cy) * scale
    puffs.push({ x, y, r: base * (0.85 + rand() * 0.5) })
    // 울퉁불퉁하게: 군데군데 곁가지 덩어리
    if (i % 3 === 0 && puffs.length < MAX_PUFFS) {
      const a = rand() * Math.PI * 2
      const d = base * (0.4 + rand() * 0.5)
      puffs.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, r: base * (0.55 + rand() * 0.4) })
    }
  })
  return puffs.slice(0, MAX_PUFFS)
}

/** 바탕 하늘에 깔 구름: 아래는 평평하고 위로 봉긋 솟은 뭉게구름. */
export function ambientPuffs(seed: number, width: number): Puff[] {
  const rand = rng(seed)
  const puffs: Puff[] = []
  // 바닥 줄: 평평한 아랫면
  const n = Math.max(8, Math.round(width / 11))
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5
    const edge = 1 - Math.abs(t) * 1.2 // 양 끝은 작게
    puffs.push({ x: t * width, y: rand() * 5, r: (14 + rand() * 8) * (0.6 + edge * 0.6) })
  }
  // 봉우리: 가운데 쪽에 큰 덩어리 2~4개, 그 위에 작은 것
  const humps = 3 + Math.floor(rand() * 3)
  for (let h = 0; h < humps; h++) {
    const hx = (h / (humps - 1) - 0.5) * width * 0.62 + (rand() - 0.5) * 20
    const hr = (34 + rand() * 28) * (1 - Math.abs(hx / width) * 0.8)
    puffs.push({ x: hx, y: -hr * 0.45, r: hr })
    for (let k = 0; k < 4; k++) {
      puffs.push({ x: hx + (rand() - 0.5) * hr * 1.3, y: -hr * (0.55 + rand() * 0.7), r: hr * (0.45 + rand() * 0.35) })
    }
  }
  return puffs
}

export function bounds(puffs: Puff[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of puffs) {
    minX = Math.min(minX, p.x - p.r * 1.3); maxX = Math.max(maxX, p.x + p.r * 1.3)
    minY = Math.min(minY, p.y - p.r * 1.3); maxY = Math.max(maxY, p.y + p.r * 1.5)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 덩어리들을 (ox, oy) 기준으로 그린다. grow(i)는 0..1 성장 비율(변신 애니메이션용).
 * 순서: 아래 그늘 → 몸통 → 윗면 하이라이트.
 */
export function paintPuffs(
  g: CanvasRenderingContext2D,
  puffs: Puff[],
  ox: number,
  oy: number,
  s: number,
  grow: (i: number) => number = () => 1,
) {
  for (let i = 0; i < puffs.length; i++) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s * 1.12
    g.drawImage(SHADE, ox + p.x * s - r, oy + (p.y + p.r * 0.32) * s - r, r * 2, r * 2)
  }
  for (let i = 0; i < puffs.length; i++) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s
    g.drawImage(BODY, ox + p.x * s - r, oy + p.y * s - r, r * 2, r * 2)
  }
  for (let i = 0; i < puffs.length; i += 2) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s * 0.5
    g.drawImage(GLOW, ox + (p.x - p.r * 0.2) * s - r, oy + (p.y - p.r * 0.35) * s - r, r * 2, r * 2)
  }
}

/** 다 자란 구름을 캔버스 한 장으로 굽는다. 이후 매 프레임 drawImage 한 번. */
export function bake(puffs: Puff[], res: number) {
  const b = bounds(puffs)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.ceil(w * res))
  cv.height = Math.max(1, Math.ceil(h * res))
  const g = cv.getContext('2d')!
  paintPuffs(g, puffs, -b.minX * res, -b.minY * res, res)
  // 원점(그림 가운데)이 스프라이트 안 어디에 있는지
  return { canvas: cv, w, h, ox: -b.minX, oy: -b.minY }
}
