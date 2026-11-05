/** Pages Functions 공용: 환경, 응답, 입력 검증. */

export type Env = {
  DB: D1Database
  IP_SALT?: string
  ACCESS_TEAM_DOMAIN?: string // 예: myteam.cloudflareaccess.com
  ACCESS_AUD?: string
  DEV_ADMIN_BYPASS?: string
}

export type Status = 'pending' | 'approved' | 'rejected' | 'hidden'
export const STATUSES: readonly Status[] = ['pending', 'approved', 'rejected', 'hidden']

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export function fail(status: number, code: string) {
  return json({ error: code }, status)
}

export const LIMITS = {
  maxBody: 64 * 1024,
  maxStrokes: 80,
  maxCoords: 4000, // x,y 합친 숫자 개수
  maxCoord: 4000,
  nickLen: 10,
  perHour: 5,
  perDay: 20,
  maxPending: 500,
}

/** 선 데이터 검증: number[][] (각 스트로크는 x,y 평탄화, 정수). 틀리면 null. */
export function cleanPts(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.maxStrokes) return null
  let total = 0
  const out: number[][] = []
  for (const s of v) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0) return null
    total += s.length
    if (total > LIMITS.maxCoords) return null
    const row: number[] = []
    for (const n of s) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > LIMITS.maxCoord) return null
      row.push(n)
    }
    out.push(row)
  }
  return out
}

// 제어문자, 보이지 않는 폭 0 문자, 줄·문단 구분자, 방향 바꾸기 문자
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g')

/** 닉네임: 제어문자·앞뒤 공백 제거, 10글자(코드포인트) 이하. 틀리면 null. */
export function cleanNick(v: unknown): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return null
  const s = v.replace(CONTROL, '').trim()
  if ([...s].length > LIMITS.nickLen) return null
  return s
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
