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

/** 구름 id(UUID) 모양인지 */
export const isId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s)

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', // _headers 는 정적 파일에만 붙는다
      ...headers,
    },
  })
}

export function fail(status: number, code: string, headers: Record<string, string> = {}) {
  return json({ error: code }, status, headers)
}

export const LIMITS = {
  maxBody: 64 * 1024,
  maxStrokes: 80,
  maxCoords: 4000, // x,y 합친 숫자 개수
  maxCoord: 4000,
  nickLen: 10,
  perHour: 5,
  perDay: 20,
  perIpPending: 10, // 한 접속이 대기열에 쌓아 둘 수 있는 수
  maxPending: 500,
  hashTtl: 2 * 86400_000, // 접속 해시는 하루 제한에만 쓰므로 이틀 뒤 지운다
  pendingTtl: 14 * 86400_000, // 이보다 오래 확인받지 못한 대기는 거절로 넘긴다
  tidyEvery: 10 * 60_000, // 정리는 이 간격에 한 번만
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

// 제어문자, 보이지 않는 글자(폭 0, 소프트 하이픈, 한글 채움 문자, BOM), 줄·문단 구분자, 방향 바꾸기 문자
const CONTROL = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u115f\\u1160\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\u3164\\ufeff\\uffa0]',
  'g',
)

/** 닉네임: 제어문자·앞뒤 공백 제거, 10글자(코드포인트) 이하. 틀리면 null. */
export function cleanNick(v: unknown): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return null
  const s = v.replace(CONTROL, '').trim()
  if ([...s].length > LIMITS.nickLen) return null
  return s
}

/**
 * 횟수 제한에 쓸 접속 단위.
 * IPv6 는 한 회선이 /64 를 통째로 쓰므로 앞 64비트만 본다. IPv4 와 IPv4 를 감싼 IPv6 는 주소 전체.
 */
export function ipKey(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (!s.includes(':')) return s || 'unknown'
  let head = s
  let v4 = ''
  const dot = s.lastIndexOf(':')
  if (s.slice(dot + 1).includes('.')) {
    v4 = s.slice(dot + 1)
    head = s.slice(0, dot) + ':0:0' // 뒤 32비트 자리
  }
  const halves = head.split('::')
  if (halves.length > 2) return s
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return s
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right].map((g) => parseInt(g, 16))
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return s
  // ::ffff:a.b.c.d (IPv4 를 감싼 주소)는 IPv4 로 센다
  if (v4 && groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return v4
  return groups.slice(0, 4).map((g) => g.toString(16)).join(':') + '::/64'
}

/** 본문을 max 바이트까지만 읽는다. 넘으면 읽기를 끊고 null. */
export async function readBody(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') || 0) > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

/** content-type 이 정확히 application/json 인지. 'text/plain; application/json' 같은 단순 요청 흉내를 받지 않는다. */
export function isJson(request: Request) {
  return (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json'
}

/** 다른 사이트의 화면이 보낸 요청인지(브라우저는 교차 출처 POST 에 Origin 을 붙인다) */
export function crossSite(request: Request) {
  const origin = request.headers.get('origin')
  return !!origin && origin !== new URL(request.url).origin
}

export function isLocal(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 0 이상 2^31 미만 난수(무작위 뽑기용 열 값) */
export function rnd31() {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1
}
