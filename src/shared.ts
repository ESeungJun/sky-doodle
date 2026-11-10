/** 다른 사람과 같이 보는 하늘: 공유 제출과 승인된 구름 받아 오기. */
import { flatten, type Stroke } from './geom.ts'

export type SharedCloud = { id: string; seed: number; nick: string; pts: number[][]; reviewedAt?: number }

// 서버 한도(functions/_lib.ts 의 LIMITS)보다 여유 있게. tests/shared.test.ts 가 둘을 맞춰 본다
export const MAX_COORDS = 3600
export const MAX_STROKES = 80
const MAX_COORD = 4000

/** 서버로 보낼 선 데이터: 정수, 0 이상, 개수 한도 안으로 간격을 넓혀 가며 줄인다. */
export function sharePts(strokes: Stroke[]): number[][] {
  const used = strokes.filter((s) => s.pts.length > 0).slice(0, MAX_STROKES)
  let minX = Infinity
  let minY = Infinity
  for (const s of used) for (const p of s.pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
  }
  let spacing = 4
  for (;;) {
    const out = flatten(used, spacing, minX, minY)
      .filter((row) => row.length >= 2)
      .map((row) => row.map((n) => Math.min(MAX_COORD, Math.max(0, n))))
    const total = out.reduce((n, r) => n + r.length, 0)
    // 획마다 점 하나는 남으므로(80획 = 160개) 간격을 넓히다 보면 반드시 한도 안에 든다
    if (total <= MAX_COORDS || spacing > 1e6) return out
    spacing *= 1.5
  }
}

export type SubmitResult = { result: 'ok'; id: string } | { result: 'too_many' | 'queue_full' | 'error' }

export async function submitCloud(seed: number, pts: number[][], nick: string): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/clouds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed, pts, nick }),
    })
    if (res.status === 201) {
      const { id } = (await res.json()) as { id?: unknown }
      return { result: 'ok', id: typeof id === 'string' ? id : '' }
    }
    if (res.status === 429) return { result: 'too_many' }
    if (res.status === 503) return { result: 'queue_full' }
    return { result: 'error' }
  } catch {
    return { result: 'error' }
  }
}

/** 보낸 구름 가운데 승인된 것의 id */
export async function approvedOf(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  try {
    const res = await fetch(`/api/clouds/status?ids=${ids.slice(-20).join(',')}`)
    if (!res.ok) return []
    const data = (await res.json()) as { approved?: unknown }
    return Array.isArray(data.approved) ? data.approved.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export const POLL_BASE = 30_000
export const POLL_MAX = 120_000
export const IDLE_AFTER = 5 * 60_000

/** 새 구름이 없던 횟수에 따라 다음 확인까지 기다릴 시간: 30초 → 60초 → 120초 */
export function nextPollDelay(emptyStreak: number) {
  return Math.min(POLL_MAX, POLL_BASE * 2 ** Math.max(0, emptyStreak))
}

/** 지금 서버에 물어도 되는지: 화면이 보이고, 마지막 조작에서 5분이 지나지 않았을 때만 */
export function shouldPoll(hidden: boolean, sinceInput: number) {
  return !hidden && sinceInput < IDLE_AFTER
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
      // 브라우저가 잠깐 보관한 응답일 수 있으므로 시각은 한 번만 받는다(조금 이른 시각이면 다시 받을 뿐이다)
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

  /** 마지막 확인 뒤에 새로 승인된 구름(clouds)과 내려간 구름 id(gone). */
  async fresh(): Promise<{ clouds: SharedCloud[]; gone: string[] }> {
    const none = { clouds: [], gone: [] }
    if (!this.since) {
      await this.fill(5, [])
      return none
    }
    try {
      const res = await fetch(`/api/clouds?after=${this.since}&n=3`)
      if (!res.ok) return none
      const data = (await res.json()) as { clouds?: SharedCloud[]; gone?: unknown; now?: number }
      const got = (data.clouds ?? []).filter(valid)
      const gone = Array.isArray(data.gone) ? data.gone.filter((s): s is string => typeof s === 'string') : []
      // 한 번에 3개까지만 받으므로, 더 있으면 마지막으로 받은 것 뒤부터 다음에 이어 받는다
      if (got.length < 3 && typeof data.now === 'number') this.since = data.now
      else if (got.length) this.since = Math.max(this.since, ...got.map((c) => c.reviewedAt ?? 0)) || this.since
      // 내려간 구름은 아직 띄우지 않은 대기 줄에서도 뺀다
      if (gone.length) this.queue = this.queue.filter((c) => !gone.includes(c.id))
      return { clouds: got.filter((c) => !gone.includes(c.id)), gone }
    } catch {
      return none
    }
  }

  /** 다음에 띄울 구름. 이미 화면에 있는 것(onScreen)은 건너뛴다. */
  next(onScreen: string[] = []): SharedCloud | undefined {
    for (;;) {
      const c = this.queue.shift()
      if (!c || !onScreen.includes(c.id)) return c
    }
  }
}

export function valid(c: SharedCloud) {
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.seed === 'number' &&
    typeof c.nick === 'string' &&
    Array.isArray(c.pts) &&
    c.pts.every((r) => Array.isArray(r) && r.every((n) => typeof n === 'number'))
  )
}

