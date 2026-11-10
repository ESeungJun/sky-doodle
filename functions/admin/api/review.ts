import { crossSite, fail, isId, isJson, json, type Env, type Status } from '../../_lib.ts'

const ALLOWED: readonly Status[] = ['approved', 'rejected', 'hidden', 'pending']

/**
 * POST /admin/api/review
 * - {ids, status} — 승인·거절·내리기(되돌리기 포함)
 * - {ids, status: 'approved', clearNick: true} — 이름만 지우고 승인
 * - {senderOf: id} — 그 구름을 보낸 접속의 대기 구름을 전부 거절
 */
export const onRequestPost: PagesFunction<Env, string, { who?: string }> = async ({ request, env, data }) => {
  // 다른 사이트에서 보낸 폼 요청을 막는다(Access 쿠키가 같이 갈 수 있으므로)
  if (crossSite(request)) return fail(403, 'bad_origin')
  if (!isJson(request)) return fail(415, 'json_only')

  let body: { ids?: unknown; status?: unknown; clearNick?: unknown; senderOf?: unknown }
  try {
    body = await request.json()
  } catch {
    return fail(400, 'bad_json')
  }
  if (!body || typeof body !== 'object') return fail(400, 'bad_json')
  const now = Date.now()
  const who = data.who ?? 'unknown'

  if (body.senderOf !== undefined) {
    if (!isId(body.senderOf)) return fail(400, 'bad_ids')
    const res = await env.DB.prepare(
      `UPDATE clouds SET status = 'rejected', reviewed_at = ?1, reviewed_by = ?2
       WHERE status = 'pending' AND ip_hash != '' AND ip_hash = (SELECT ip_hash FROM clouds WHERE id = ?3)`,
    )
      .bind(now, who, body.senderOf)
      .run()
    return json({ changed: res.meta.changes || 0 })
  }

  const status = ALLOWED.find((s) => s === body.status)
  if (!status) return fail(400, 'bad_status')
  const ids = Array.isArray(body.ids) ? body.ids.filter(isId) : []
  if (ids.length === 0 || ids.length > 100) return fail(400, 'bad_ids')

  const clear = body.clearNick === true && status === 'approved'
  // 승인된 구름은 내리기만 된다: 열린 화면에 '내려갔다'를 알리는 길이 내림 하나이기 때문이다(api/clouds.ts 의 gone)
  const keep = status === 'rejected' || status === 'pending' ? " AND status != 'approved'" : ''
  const stmt = env.DB.prepare(
    `UPDATE clouds SET status = ?, reviewed_at = ?, reviewed_by = ?${clear ? ", nick = ''" : ''} WHERE id = ?${keep}`,
  )
  const res = await env.DB.batch(ids.map((id) => stmt.bind(status, now, who, id)))
  const changed = res.reduce((n, r) => n + (r.meta.changes || 0), 0)
  return json({ changed })
}
