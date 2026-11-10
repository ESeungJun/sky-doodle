/** 선 → 구름 덩어리 계산. 화면(DOM) 없이 돈다: 테스트와 서버 쪽 검증 기준이 여기다. */

export type Pt = { x: number; y: number }
/** 한 획: 점들과 붓 굵기(px) */
export type Stroke = { pts: Pt[]; w: number }
export type Puff = { x: number; y: number; r: number }

/** 기본 연필 굵기(px). 연필 세 자루(index.html 의 data-w)는 3·5·9 이고 굵기가 그대로 구름 두께가 된다. */
export const BASE_W = 5
export const MAX_PUFFS = 520

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
export function resample(lines: Pt[][], spacing: number): Pt[] {
  const out: Pt[] = []
  for (const s of lines) {
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

/** 붓 굵기가 덩어리 반지름에 곱해지는 비율(가는 0.7 ~ 굵은 1.5 안팎) */
export function girth(w: number) {
  return Math.min(1.8, Math.max(0.6, (w / BASE_W) ** 0.7))
}

/**
 * 선 모양을 따라 뭉게구름 덩어리를 배치한다.
 * puffs 좌표는 그림의 가운데가 (0,0)이고, cx·cy 는 그 가운데가 종이 위 어디였는지다.
 */
export function layoutCloud(strokes: Stroke[], seed: number, scale = 1.15): { puffs: Puff[]; cx: number; cy: number } {
  let total = 0
  for (const s of strokes) for (let i = 1; i < s.pts.length; i++) total += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y)
  const spacing = Math.max(6, total / (MAX_PUFFS / 1.6))
  const pts: (Pt & { g: number })[] = []
  for (const s of strokes) {
    const g = girth(s.w)
    for (const p of resample([s.pts], spacing)) pts.push({ x: p.x, y: p.y, g })
  }
  if (pts.length === 0) return { puffs: [], cx: 0, cy: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const rand = rng(seed)
  const puffs: Puff[] = []
  pts.forEach((p, i) => {
    const base = 13 * scale * p.g
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
  return { puffs: puffs.slice(0, MAX_PUFFS), cx, cy }
}

/** 다른 사람 구름을 띄울 배율: 큰 화면에서 그린 그림도 비슷한 크기(긴 변 260px 안팎)로 */
export function sharedScale(strokes: Stroke[]) {
  let maxDim = 1
  for (const s of strokes) for (const p of s.pts) maxDim = Math.max(maxDim, p.x, p.y)
  return 1.15 * Math.min(1, 260 / maxDim)
}

export function puffsFromStrokes(strokes: Stroke[], seed: number, scale = 1.15): Puff[] {
  return layoutCloud(strokes, seed, scale).puffs
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

/** 구름(w×h)이 정사각 그림(size)의 가운데 fill 비율 안에 들어오게 하는 배율 */
export function fitScale(w: number, h: number, size: number, fill = 0.62) {
  return Math.min((size * fill) / Math.max(1, w), (size * fill) / Math.max(1, h))
}

/** 점 p 가 획에서 reach(px) 안에 있는지: 지우개가 문지른 획을 고를 때 */
export function nearStroke(s: Stroke, p: Pt, reach: number): boolean {
  const lim = reach + s.w / 2
  if (s.pts.length === 1) return Math.hypot(s.pts[0].x - p.x, s.pts[0].y - p.y) <= lim
  for (let i = 1; i < s.pts.length; i++) {
    const a = s.pts[i - 1]
    const b = s.pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= lim) return true
  }
  return false
}

/** 저장·전송용: 획마다 x,y 를 번갈아 늘어놓은 정수 배열 */
export function flatten(strokes: Stroke[], spacing: number, ox = 0, oy = 0): number[][] {
  return strokes.map((s) => resample([s.pts], spacing).flatMap((p) => [Math.round(p.x - ox), Math.round(p.y - oy)]))
}

/** flatten 의 반대. ws 가 없거나 모자라면 기본 굵기. */
export function toStrokes(pts: number[][], ws?: number[]): Stroke[] {
  return pts.map((flat, k) => {
    const s: Pt[] = []
    if (!Array.isArray(flat)) return { pts: s, w: BASE_W } // 손상된 저장분
    for (let i = 0; i + 1 < flat.length; i += 2) s.push({ x: Number(flat[i]) || 0, y: Number(flat[i + 1]) || 0 })
    const w = Number(ws?.[k])
    return { pts: s, w: w >= 1 && w <= 20 ? w : BASE_W }
  })
}

/**
 * 종이에 닿은 포인터 가운데 하나만 그리게 한다.
 * 손가락 두 개·손바닥이 같이 닿아도 먼저 닿은 것만 선이 되고, 펜은 손(터치)보다 우선한다.
 */
export class PointerGate {
  private id: number | null = null
  private kind = ''

  /** start: 이 포인터로 그리기 시작 / takeover: 펜이 손을 밀어냄(그리던 선은 버린다) / ignore: 무시 */
  down(id: number, kind: string): 'start' | 'takeover' | 'ignore' {
    if (this.id === null) {
      this.id = id
      this.kind = kind
      return 'start'
    }
    if (id !== this.id && kind === 'pen' && this.kind !== 'pen') {
      this.id = id
      this.kind = kind
      return 'takeover'
    }
    return 'ignore'
  }

  owns(id: number) {
    return this.id === id
  }

  get active() {
    return this.id !== null
  }

  /** 그리던 포인터가 떨어졌으면 true */
  up(id: number) {
    if (this.id !== id) return false
    this.id = null
    this.kind = ''
    return true
  }

  reset() {
    this.id = null
    this.kind = ''
  }
}
