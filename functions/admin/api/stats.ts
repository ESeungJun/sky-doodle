import { json, STATUSES, type Env } from '../../_lib.ts'

/** GET /admin/api/stats — 오늘(한국 시간) 제출 수와 상태별 개수. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const KST = 9 * 3600_000
  const now = Date.now()
  const todayStart = Math.floor((now + KST) / 86400_000) * 86400_000 - KST
  // 상태별 개수는 (status, created_at) 색인만 읽는다
  const [today, byStatus] = await env.DB.batch<{ n: number; status?: string }>([
    env.DB.prepare('SELECT COUNT(*) AS n FROM clouds WHERE created_at >= ?').bind(todayStart),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM clouds GROUP BY status'),
  ])
  const out: Record<string, number> = { today: Number(today.results[0]?.n ?? 0) }
  for (const s of STATUSES) out[s] = Number(byStatus.results.find((r) => r.status === s)?.n ?? 0)
  return json(out)
}
