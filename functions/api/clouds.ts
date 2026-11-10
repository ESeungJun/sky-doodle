import { cleanNick, cleanPts, crossSite, fail, ipKey, isId, isJson, isLocal, json, LIMITS, readBody, rnd31, sha256, type Env } from '../_lib.ts'

type Row = { id: string; seed: number; pts: string; nick: string; reviewed_at: number | null }
const COLS = 'id, seed, pts, nick, reviewed_at'

const GONE_PAGE = 100 // 한 번에 내릴 수 있는 수(review.ts)와 같다

const toCloud = (r: Row) => ({
  id: r.id,
  seed: r.seed,
  nick: r.nick,
  reviewedAt: r.reviewed_at ?? 0,
  pts: JSON.parse(r.pts) as number[][],
})

/**
 * GET /api/clouds?n=5&not=id1,id2 — 승인된 구름을 무작위로.
 * GET /api/clouds?after=<ms> — 그 시각 뒤에 승인된 구름(clouds)과 내려간 구름 id(gone).
 * 응답의 now를 다음 after로 쓴다.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const n = Math.min(8, Math.max(1, Number(url.searchParams.get('n')) || 5))
  const now = Date.now()
  const after = Number(url.searchParams.get('after'))

  if (Number.isFinite(after) && after > 0) {
    const [fresh, gone] = await env.DB.batch<Row | { id: string; reviewed_at: number }>([
      env.DB.prepare(
        `SELECT ${COLS} FROM clouds WHERE status = 'approved' AND reviewed_at > ? AND reviewed_at <= ?
         ORDER BY reviewed_at ASC LIMIT ?`,
      ).bind(after, now, n),
      // 내려간 구름: 열어 둔 화면에서 빼야 한다. 승인된 구름이 승인 밖으로 나가는 길은 내림뿐이다(review.ts)
      env.DB.prepare(
        `SELECT id, reviewed_at FROM clouds WHERE status = 'hidden' AND reviewed_at > ? AND reviewed_at <= ?
         ORDER BY reviewed_at ASC LIMIT ?`,
      ).bind(after, now, GONE_PAGE),
    ])
    const hidden = gone.results as { id: string; reviewed_at: number }[]
    // 한 번에 다 못 실었으면 실은 데까지만 봤다고 알려, 다음 확인이 그 뒤부터 이어 받게 한다
    const seen = hidden.length === GONE_PAGE ? hidden[hidden.length - 1].reviewed_at : now
    return json({ clouds: (fresh.results as Row[]).filter((r) => (r.reviewed_at ?? 0) <= seen).map(toCloud), gone: hidden.map((r) => r.id), now: seen })
  }

  const not = (url.searchParams.get('not') || '').split(',').filter(isId).slice(0, 30)
  const skip = not.length ? ` AND id NOT IN (${not.map(() => '?').join(',')})` : ''
  // rnd 열의 임의 지점에서 색인 순서로 n개. 끝에 닿으면 앞에서 마저 채운다
  const pivot = rnd31()
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM clouds WHERE status = 'approved' AND rnd >= ?${skip} ORDER BY rnd LIMIT ?`,
  )
    .bind(pivot, ...not, n)
    .all<Row>()
  if (results.length < n) {
    const more = await env.DB.prepare(
      `SELECT ${COLS} FROM clouds WHERE status = 'approved' AND rnd < ?${skip} ORDER BY rnd LIMIT ?`,
    )
      .bind(pivot, ...not, n - results.length)
      .all<Row>()
    results.push(...more.results)
  }
  // 이웃한 rnd 끼리 늘 같은 순서로 나오지 않게 섞는다
  for (let i = results.length - 1; i > 0; i--) {
    const j = rnd31() % (i + 1)
    ;[results[i], results[j]] = [results[j], results[i]]
  }
  // 같은 주소를 다시 부르면(새로고침·뒤로 가기) 잠깐은 브라우저가 가진 것을 쓴다
  return json({ clouds: results.map(toCloud), now }, 200, { 'cache-control': 'private, max-age=30' })
}

/** POST /api/clouds {seed, pts, nick} — 확인 대기로 저장. */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx
  // 다른 사이트가 방문자 브라우저를 시켜 대신 제출하게 하는 것을 막는다
  if (crossSite(request)) return fail(403, 'bad_origin')
  if (!isJson(request)) return fail(415, 'json_only')
  const text = await readBody(request, LIMITS.maxBody)
  if (text === null) return fail(413, 'too_large')

  let body: { seed?: unknown; pts?: unknown; nick?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'bad_json')
  }
  if (!body || typeof body !== 'object') return fail(400, 'bad_json')
  const seed = body.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) return fail(400, 'bad_seed')
  const pts = cleanPts(body.pts)
  if (!pts) return fail(400, 'bad_pts')
  const nick = cleanNick(body.nick)
  if (nick === null) return fail(400, 'bad_nick')

  // 소금이 없으면 공개된 기본값으로 해시하게 되므로 운영에서는 받지 않는다
  const salt = env.IP_SALT || (isLocal(new URL(request.url)) ? 'sky-doodle-dev' : '')
  if (!salt) return fail(500, 'not_configured')
  const ipHash = await sha256(`${salt}:${ipKey(request.headers.get('cf-connecting-ip') || 'unknown')}`)
  const now = Date.now()
  const id = crypto.randomUUID()

  // 이 접속의 몫부터 본다(색인으로 많아야 수십 행). 도배하는 쪽이 여기서 싸게 걸러진다
  const mine = () =>
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?1 AND created_at > ?2) AS hour,
         (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?1 AND created_at > ?3) AS day,
         (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?1 AND status = 'pending') AS pending`,
    )
      .bind(ipHash, now - 3600_000, now - 86400_000)
      .first<{ hour: number; day: number; pending: number }>()
  const over = (c: { hour: number; day: number; pending: number } | null) =>
    !!c && (c.hour >= LIMITS.perHour || c.day >= LIMITS.perDay || c.pending >= LIMITS.perIpPending)
  if (over(await mine())) return fail(429, 'too_many')

  // 개수 확인과 저장을 한 문장으로: 동시에 보내도 제한을 넘지 못한다
  const insert = () =>
    env.DB.prepare(
      `INSERT INTO clouds (id, seed, pts, nick, ip_hash, created_at, rnd)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE (SELECT COUNT(*) FROM clouds WHERE status = 'pending') < ?8
         AND (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?5 AND created_at > ?9) < ?10
         AND (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?5 AND created_at > ?11) < ?12
         AND (SELECT COUNT(*) FROM clouds WHERE ip_hash = ?5 AND status = 'pending') < ?13`,
    )
      .bind(
        id, seed, JSON.stringify(pts), nick, ipHash, now, rnd31(),
        LIMITS.maxPending, now - 3600_000, LIMITS.perHour, now - 86400_000, LIMITS.perDay, LIMITS.perIpPending,
      )
      .run()

  if ((await insert()).meta.changes) {
    ctx.waitUntil(tidy(env, now)) // 정리는 응답 뒤에
    return json({ id, status: 'pending' }, 201)
  }
  // 막혔으면 오래된 대기를 치우고 한 번 더: 묵은 대기가 새 전송을 막지 않게. 방금 정리했으면 다시 하지 않는다
  if ((await tidy(env, now)) && (await insert()).meta.changes) return json({ id, status: 'pending' }, 201)
  // 동시에 보낸 요청에 밀려 이 접속의 몫을 넘긴 것이 아니면 전체 대기가 찬 것이다
  return over(await mine()) ? fail(429, 'too_many') : fail(503, 'queue_full')
}

/**
 * 오래된 대기를 거절로 넘기고, 제한에 더 쓰지 않는 접속 해시를 지운다.
 * 10분에 한 번만 돈다(meta 의 tidy_at). 돌았으면 true.
 */
async function tidy(env: Env, now: number) {
  try {
    const turn = await env.DB.prepare(
      `INSERT INTO meta (key, value) VALUES ('tidy_at', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) <= ?2`,
    )
      .bind(String(now), now - LIMITS.tidyEvery)
      .run()
    if (!turn.meta.changes) return false
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE clouds SET status = 'rejected', reviewed_at = ?1, reviewed_by = 'auto' WHERE status = 'pending' AND created_at < ?2`,
      ).bind(now, now - LIMITS.pendingTtl),
      // 대기 중인 것은 '같은 접속 한꺼번에 거절'에 쓰이므로 확인이 끝난 뒤에 지운다
      env.DB.prepare(`UPDATE clouds SET ip_hash = '' WHERE ip_hash != '' AND created_at < ? AND status != 'pending'`).bind(
        now - LIMITS.hashTtl,
      ),
    ])
    return true
  } catch (e) {
    console.error(JSON.stringify({ at: 'tidy', error: String(e) }))
    return false
  }
}

/** GET·POST 밖의 메서드는 index.html 이 아니라 405 로 답한다. */
export const onRequest: PagesFunction<Env> = () => fail(405, 'method_not_allowed', { allow: 'GET, POST' })
