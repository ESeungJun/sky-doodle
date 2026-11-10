import { fail, isLocal, type Env } from '../_lib.ts'

/**
 * /admin 아래 모든 요청(화면·API)은 Cloudflare Access를 통과해야 한다.
 * Access가 앞에서 막지만, 여기서도 Access 토큰(JWT)을 직접 검증한다. 설정이 없으면 막는다.
 */

type Jwk = JsonWebKey & { kid: string }
let keyCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null
let refetchedAt = 0 // 모르는 kid 로 키를 다시 받은 시각

async function accessKeys(domain: string) {
  if (keyCache && keyCache.domain === domain && Date.now() - keyCache.at < 3600_000) return keyCache.keys
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error('certs')
  const { keys } = (await res.json()) as { keys: Jwk[] }
  const map = new Map<string, CryptoKey>()
  for (const k of keys) {
    map.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
  }
  keyCache = { domain, at: Date.now(), keys: map }
  return map
}

function b64url(s: string) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0))
}

/** 토큰 한 토막(base64url JSON)을 읽는다. 모양이 틀리면 null. */
function part<T>(s: string): T | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64url(s)))
    return v && typeof v === 'object' ? (v as T) : null
  } catch {
    return null
  }
}

/** 통과하면 메일 주소, 아니면 null. 키를 받아 오지 못할 때만 던진다. */
async function verifyAccess(token: string, env: Env) {
  const domain = env.ACCESS_TEAM_DOMAIN
  const aud = env.ACCESS_AUD
  if (!domain || !aud) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const header = part<{ alg?: string; kid?: string }>(parts[0])
  if (!header || header.alg !== 'RS256' || !header.kid) return null
  let sig: Uint8Array
  try {
    sig = b64url(parts[2])
  } catch {
    return null
  }
  let key = (await accessKeys(domain)).get(header.kid)
  if (!key) {
    // 키가 바뀌었을 수 있다. 엉터리 kid 로 키 서버를 두드리지 못하게 다시 받기는 1분에 한 번만
    if (Date.now() - refetchedAt < 60_000) return null
    refetchedAt = Date.now()
    keyCache = null
    key = (await accessKeys(domain)).get(header.kid)
    if (!key) return null
  }
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) return null
  const p = part<{ aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string }>(parts[1])
  if (!p) return null
  const now = Date.now() / 1000
  const auds = Array.isArray(p.aud) ? p.aud : [p.aud]
  if (!auds.includes(aud)) return null
  if (typeof p.exp !== 'number' || p.exp < now) return null
  if (typeof p.nbf === 'number' && p.nbf > now + 60) return null
  if (p.iss !== `https://${domain}`) return null
  return typeof p.email === 'string' && p.email ? p.email : 'unknown'
}

export const onRequest: PagesFunction<Env, string, { who?: string }> = async (ctx) => {
  const { request, env } = ctx
  if (env.DEV_ADMIN_BYPASS === '1' && isLocal(new URL(request.url))) {
    ctx.data.who = 'local-dev'
    return ctx.next()
  }

  const token = request.headers.get('cf-access-jwt-assertion')
  let who: string | null = null
  try {
    who = token ? await verifyAccess(token, env) : null
  } catch {
    return fail(503, 'auth_unavailable')
  }
  if (!who) return fail(403, 'forbidden')
  ctx.data.who = who // 누가 확인했는지 남긴다(review.ts)

  const res = await ctx.next()
  // 어드민 화면은 캐시하지 않게
  const out = new Response(res.body, res)
  out.headers.set('cache-control', 'no-store')
  return out
}
