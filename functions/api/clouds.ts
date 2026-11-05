import { cleanNick, cleanPts, fail, json, LIMITS, sha256, type Env } from '../_lib'

/**
 * GET /api/clouds?n=5&not=id1,id2 — 승인된 구름을 랜덤으로.
 * GET /api/clouds?after=<ms> — 그 시각 뒤에 승인된 구름(열어 둔 화면에 새로 띄울 것).
 * 응답의 now를 다음 after로 쓴다.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const n = Math.min(8, Math.max(1, Number(url.searchParams.get('n')) || 5))
  const now = Date.now()
  const after = Number(url.searchParams.get('after'))
  type Row = { id: string; seed: number; pts: string; nick: string; reviewed_at: number | null }
  let results: Row[]
  if (Number.isFinite(after) && after > 0) {
    ;({ results } = await env.DB.prepare(
      `SELECT id, seed, pts, nick, reviewed_at FROM clouds WHERE status = 'approved' AND reviewed_at > ? AND reviewed_at <= ?
       ORDER BY reviewed_at ASC LIMIT ?`,
    )
      .bind(after, now, n)
      .all<Row>())
  } else {
    const not = (url.searchParams.get('not') || '')
      .split(',')
      .filter((s) => /^[0-9a-f-]{36}$/.test(s))
      .slice(0, 30)
    const holes = not.map(() => '?').join(',')
    const sql =
      `SELECT id, seed, pts, nick, reviewed_at FROM clouds WHERE status = 'approved'` +
      (not.length ? ` AND id NOT IN (${holes})` : '') +
      ` ORDER BY RANDOM() LIMIT ?`
    ;({ results } = await env.DB.prepare(sql)
      .bind(...not, n)
      .all<Row>())
  }
  const clouds = results.map((r) => ({
    id: r.id,
    seed: r.seed,
    nick: r.nick,
    reviewedAt: r.reviewed_at ?? 0,
    pts: JSON.parse(r.pts) as number[][],
  }))
  return json({ clouds, now })
}

/** POST /api/clouds {seed, pts, nick} — 검수 대기로 저장. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return fail(415, 'json_only')
  const len = Number(request.headers.get('content-length') || 0)
  if (len > LIMITS.maxBody) return fail(413, 'too_large')
  const text = await request.text()
  if (text.length > LIMITS.maxBody) return fail(413, 'too_large')

  let body: { seed?: unknown; pts?: unknown; nick?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'bad_json')
  }
  const seed = body.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) return fail(400, 'bad_seed')
  const pts = cleanPts(body.pts)
  if (!pts) return fail(400, 'bad_pts')
  const nick = cleanNick(body.nick)
  if (nick === null) return fail(400, 'bad_nick')

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const ipHash = await sha256(`${env.IP_SALT || 'sky-doodle-dev'}:${ip}`)
  const now = Date.now()

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?1 AND created_at > ?2) AS hour,
       (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?1 AND created_at > ?3) AS day,
       (SELECT COUNT(*) FROM clouds WHERE status = 'pending') AS pending`,
  )
    .bind(ipHash, now - 3600_000, now - 86400_000)
    .first<{ hour: number; day: number; pending: number }>()
  if (counts) {
    if (counts.pending >= LIMITS.maxPending) return fail(503, 'queue_full')
    if (counts.hour >= LIMITS.perHour || counts.day >= LIMITS.perDay) return fail(429, 'too_many')
  }

  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO clouds (id, seed, pts, nick, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, seed, JSON.stringify(pts), nick, ipHash, now)
    .run()
  return json({ id, status: 'pending' }, 201)
}
