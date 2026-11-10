import { isId, json, type Env } from '../../_lib.ts'

/**
 * GET /api/clouds/status?ids=a,b — 내가 보낸 구름 중 승인된 것의 id.
 * 거절·내림은 구분해 주지 않는다(승인 여부만).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').filter(isId).slice(0, 20)
  if (ids.length === 0) return json({ approved: [] })
  const { results } = await env.DB.prepare(
    `SELECT id FROM clouds WHERE status = 'approved' AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ id: string }>()
  return json({ approved: results.map((r) => r.id) })
}
