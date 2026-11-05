/** 다른 사람과 같이 보는 하늘: 공유 제출과 승인된 구름 받아 오기. */
import { resample } from './cloud'
import type { Stroke } from './pad'

export type SharedCloud = { id: string; seed: number; nick: string; pts: number[][]; reviewedAt?: number }

const MAX_COORDS = 3600 // 서버 한도(4000)보다 여유 있게
const MAX_STROKES = 80

/** 서버로 보낼 선 데이터: 정수, 0 이상, 개수 한도 안으로 간격을 넓혀 가며 줄인다. */
export function sharePts(strokes: Stroke[]): number[][] {
  const used = strokes.filter((s) => s.length > 0).slice(0, MAX_STROKES)
  let minX = Infinity
  let minY = Infinity
  for (const s of used) for (const p of s) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
  }
  let spacing = 4
  for (;;) {
    const out = used
      .map((s) => resample([s], spacing).flatMap((p) => [Math.round(p.x - minX), Math.round(p.y - minY)]))
      .filter((row) => row.length >= 2)
      .map((row) => row.map((n) => Math.min(4000, Math.max(0, n))))
    const total = out.reduce((n, r) => n + r.length, 0)
    if (total <= MAX_COORDS || spacing > 64) return out
    spacing *= 1.5
  }
}

export type SubmitResult = 'ok' | 'too_many' | 'queue_full' | 'error'

export async function submitCloud(seed: number, pts: number[][], nick: string): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/clouds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed, pts, nick }),
    })
    if (res.status === 201) return 'ok'
    if (res.status === 429) return 'too_many'
    if (res.status === 503) return 'queue_full'
    return 'error'
  } catch {
    return 'error'
  }
}

/** 승인된 구름을 순서대로 꺼내 주는 큐. 비면 서버에서 더 받아 온다(30초에 한 번까지). */
export class SharedQueue {
  private queue: SharedCloud[] = []
  private lastFetch = 0
  private loading = false
  /** 서버 시각 기준 마지막 확인 시점. 이 뒤에 승인된 구름이 '새 구름'. */
  private since = 0

  async fill(n: number, exclude: string[]) {
    if (this.loading || Date.now() - this.lastFetch < 30_000) return
    this.loading = true
    this.lastFetch = Date.now()
    try {
      const not = [...exclude, ...this.queue.map((c) => c.id)].slice(0, 30).join(',')
      const res = await fetch(`/api/clouds?n=${n}${not ? `&not=${not}` : ''}`)
      if (!res.ok) return
      const data = (await res.json()) as { clouds?: SharedCloud[]; now?: number }
      if (!this.since && typeof data.now === 'number') this.since = data.now
      for (const c of data.clouds ?? []) {
        if (valid(c) && !this.queue.some((q) => q.id === c.id)) this.queue.push(c)
      }
    } catch {
      /* 오프라인이거나 서버가 없으면(로컬 개발) 공유 구름 없이 */
    } finally {
      this.loading = false
    }
  }

  /** 마지막 확인 뒤에 새로 승인된 구름. 화면을 열어 둔 동안 주기적으로 부른다. */
  async fresh(): Promise<SharedCloud[]> {
    if (!this.since) {
      await this.fill(5, [])
      return []
    }
    try {
      const res = await fetch(`/api/clouds?after=${this.since}&n=3`)
      if (!res.ok) return []
      const data = (await res.json()) as { clouds?: SharedCloud[]; now?: number }
      const got = (data.clouds ?? []).filter(valid)
      // 한 번에 3개까지만 받으므로, 더 있으면 마지막으로 받은 것 뒤부터 다음에 이어 받는다
      if (got.length < 3 && typeof data.now === 'number') this.since = data.now
      else if (got.length) this.since = Math.max(this.since, ...got.map((c) => c.reviewedAt ?? 0)) || this.since
      return got
    } catch {
      return []
    }
  }

  next(): SharedCloud | undefined {
    return this.queue.shift()
  }
}

function valid(c: SharedCloud) {
  return (
    c &&
    typeof c.id === 'string' &&
    typeof c.seed === 'number' &&
    typeof c.nick === 'string' &&
    Array.isArray(c.pts) &&
    c.pts.every((r) => Array.isArray(r) && r.every((n) => typeof n === 'number'))
  )
}

export function toStrokes(pts: number[][]): Stroke[] {
  return pts.map((flat) => {
    const s: Stroke = []
    for (let i = 0; i + 1 < flat.length; i += 2) s.push({ x: Number(flat[i]) || 0, y: Number(flat[i + 1]) || 0 })
    return s
  })
}
