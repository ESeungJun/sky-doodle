import { fail, json, STATUSES, type Env, type Status } from '../../_lib'

/** GET /admin/api/list?status=pending&before=<created_at> — 최신순 60개씩. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const status = (url.searchParams.get('status') || 'pending') as Status
  if (!STATUSES.includes(status)) return fail(400, 'bad_status')
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER
  // 대기 목록은 오래된 것부터 검수하도록 오름차순, 나머지는 최신순
  const asc = status === 'pending'
  const after = Number(url.searchParams.get('after')) || 0
  const { results } = asc
    ? await env.DB.prepare(
        `SELECT id, seed, pts, nick, status, created_at, reviewed_at FROM clouds
         WHERE status = ? AND created_at > ? ORDER BY created_at ASC LIMIT 60`,
      )
        .bind(status, after)
        .all()
    : await env.DB.prepare(
        `SELECT id, seed, pts, nick, status, created_at, reviewed_at FROM clouds
         WHERE status = ? AND created_at < ? ORDER BY created_at DESC LIMIT 60`,
      )
        .bind(status, before)
        .all()
  const items = (results as { pts: string }[]).map((r) => ({ ...r, pts: JSON.parse(r.pts) as number[][] }))
  return json({ items })
}
