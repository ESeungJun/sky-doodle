import { fail, json, type Env } from '../../_lib'

const ALLOWED = { approved: 'approved', rejected: 'rejected', hidden: 'hidden', pending: 'pending' } as const

/** POST /admin/api/review {ids: string[], status} — 승인·거절·내리기(되돌리기 포함). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 다른 사이트에서 보낸 폼 요청을 막는다(Access 쿠키가 같이 갈 수 있으므로)
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'bad_origin')
  if (!(request.headers.get('content-type') || '').includes('application/json')) return fail(415, 'json_only')

  let body: { ids?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return fail(400, 'bad_json')
  }
  const status = typeof body.status === 'string' ? ALLOWED[body.status as keyof typeof ALLOWED] : undefined
  if (!status) return fail(400, 'bad_status')
  const ids = Array.isArray(body.ids) ? body.ids.filter((s): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s)) : []
  if (ids.length === 0 || ids.length > 100) return fail(400, 'bad_ids')

  const now = Date.now()
  const stmt = env.DB.prepare('UPDATE clouds SET status = ?, reviewed_at = ? WHERE id = ?')
  const res = await env.DB.batch(ids.map((id) => stmt.bind(status, now, id)))
  const changed = res.reduce((n, r) => n + (r.meta.changes || 0), 0)
  return json({ changed })
}
