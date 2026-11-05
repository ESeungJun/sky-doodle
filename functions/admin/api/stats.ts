import { json, type Env } from '../../_lib'

/** GET /admin/api/stats — 오늘(한국 시간) 제출 수와 상태별 개수. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const KST = 9 * 3600_000
  const now = Date.now()
  const todayStart = Math.floor((now + KST) / 86400_000) * 86400_000 - KST
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM clouds WHERE created_at >= ?) AS today,
       SUM(status = 'pending') AS pending,
       SUM(status = 'approved') AS approved,
       SUM(status = 'rejected') AS rejected,
       SUM(status = 'hidden') AS hidden
     FROM clouds`,
  )
    .bind(todayStart)
    .first<Record<string, number | null>>()
  const n = (k: string) => Number(row?.[k] ?? 0)
  return json({
    today: n('today'),
    pending: n('pending'),
    approved: n('approved'),
    rejected: n('rejected'),
    hidden: n('hidden'),
  })
}
