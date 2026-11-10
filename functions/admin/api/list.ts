import { fail, json, STATUSES, type Env, type Status } from '../../_lib.ts'

type Row = {
  id: string; seed: number; pts: string; nick: string; status: Status
  created_at: number; reviewed_at: number | null; reviewed_by: string | null; ip_hash: string
}

/** GET /admin/api/list?status=pending&before=<created_at> — 최신순 60개씩. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const status = (url.searchParams.get('status') || 'pending') as Status
  if (!STATUSES.includes(status)) return fail(400, 'bad_status')
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER
  // 대기 목록은 오래된 것부터 확인하도록 오름차순, 나머지는 최신순
  const asc = status === 'pending'
  const after = Number(url.searchParams.get('after')) || 0
  const cols = 'id, seed, pts, nick, status, created_at, reviewed_at, reviewed_by, ip_hash'
  const { results } = asc
    ? await env.DB.prepare(`SELECT ${cols} FROM clouds WHERE status = ? AND created_at > ? ORDER BY created_at ASC LIMIT 60`)
        .bind(status, after)
        .all<Row>()
    : await env.DB.prepare(`SELECT ${cols} FROM clouds WHERE status = ? AND created_at < ? ORDER BY created_at DESC LIMIT 60`)
        .bind(status, before)
        .all<Row>()
  // 접속 해시는 앞 8자만: 같은 접속끼리 묶어 보는 용도
  const items = results.map(({ ip_hash, pts, ...r }) => ({ ...r, pts: JSON.parse(pts) as number[][], sender: ip_hash.slice(0, 8) }))
  return json({ items })
}
