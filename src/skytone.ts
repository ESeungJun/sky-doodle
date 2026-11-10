/** 지금 시각의 하늘 색. 화면(DOM) 없이 도는 계산만 둔다. */

export type SkyTone = {
  /** 위에서 아래로 네 단계 */
  stops: [string, string, string, string]
  /** 해·달 둘레 빛 */
  glow: string
  /** 해·달의 색 */
  disc: string
  /** 별이 보이는 정도 0..1 */
  stars: number
  /** 구름을 얼마나 어둡게 덮을지 0..1 (밤) */
  dusk: number
  moon: boolean
}

/** stops 네 색이 세로로 놓이는 자리(0 위 ~ 1 아래) */
export const SKY_STOPS = [0, 0.45, 0.8, 1] as const

type Key = { at: number } & SkyTone

// 낮의 네 색은 처음 만든 하늘 그대로다
const DAY: SkyTone = { stops: ['#1f6fd1', '#4fa3ec', '#9fd5fb', '#d9f0ff'], glow: '#fffae1', disc: '#fffdf2', stars: 0, dusk: 0, moon: false }
const DAWN: SkyTone = { stops: ['#5a6fb8', '#a892c9', '#f2b6b0', '#ffe3c2'], glow: '#ffe1c4', disc: '#fff1dc', stars: 0.1, dusk: 0.12, moon: false }
const SUNSET: SkyTone = { stops: ['#27407f', '#6a5aa0', '#f09a6a', '#ffd59a'], glow: '#ffc98a', disc: '#ffe9c7', stars: 0.15, dusk: 0.18, moon: false }
const NIGHT: SkyTone = { stops: ['#0b1736', '#14275a', '#243f7a', '#3a5a94'], glow: '#c9d8ff', disc: '#f1f4ff', stars: 1, dusk: 0.42, moon: true }

const KEYS: Key[] = [
  { at: 0, ...NIGHT },
  { at: 4.5, ...NIGHT },
  { at: 6, ...DAWN },
  { at: 8.5, ...DAY },
  { at: 16.5, ...DAY },
  { at: 18.5, ...SUNSET },
  { at: 20.5, ...NIGHT },
  { at: 24, ...NIGHT },
]

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t)
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)
}

/** hour: 0 이상 24 미만(소수 가능). 기준 시각 사이는 부드럽게 섞는다. */
export function skyAt(hour: number): SkyTone {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < KEYS.length - 2 && h >= KEYS[i + 1].at) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = Math.min(1, Math.max(0, (h - a.at) / (b.at - a.at)))
  return {
    stops: [0, 1, 2, 3].map((k) => mixHex(a.stops[k], b.stops[k], t)) as SkyTone['stops'],
    glow: mixHex(a.glow, b.glow, t),
    disc: mixHex(a.disc, b.disc, t),
    stars: a.stars + (b.stars - a.stars) * t,
    dusk: a.dusk + (b.dusk - a.dusk) * t,
    moon: t < 0.5 ? a.moon : b.moon,
  }
}

/** 날짜마다 다른 시드: 바탕 구름이 하루 동안은 같고 다음 날은 다르다. */
export function daySeed(d: Date) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}
