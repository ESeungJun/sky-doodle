/** 구름 그리기: 덩어리 스프라이트를 겹쳐 그리고 한 장으로 굽는다. 모양 계산은 geom.ts. */
import { bounds, type Puff } from './geom.ts'

const SPRITE = 128

/** 구름 덩어리 한 개 모양(몸통·그림자)을 미리 그려 둔 스프라이트. 매 퍼프마다 그라디언트를 만들지 않으려고. */
function makeSprite(paint: (g: CanvasRenderingContext2D, c: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = SPRITE
  const g = cv.getContext('2d')!
  paint(g, SPRITE / 2)
  return cv
}

const BODY = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c * 1.18, c * 0.7, c * 0.05, c, c, c) // 밝은 쪽이 해(오른쪽 위)를 향한다
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.97)')
  grad.addColorStop(0.8, 'rgba(244,248,255,0.75)')
  grad.addColorStop(1, 'rgba(236,243,252,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

const SHADE = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(150,172,204,0.55)')
  grad.addColorStop(0.6, 'rgba(160,182,212,0.3)')
  grad.addColorStop(1, 'rgba(170,190,218,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

const GLOW = makeSprite((g, c) => {
  const grad = g.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
})

/**
 * 덩어리들을 (ox, oy) 기준으로 그린다. grow(i)는 0..1 성장 비율(변신 애니메이션용).
 * 순서: 아래 그늘 → 몸통 → 윗면 하이라이트.
 */
export function paintPuffs(
  g: CanvasRenderingContext2D,
  puffs: Puff[],
  ox: number,
  oy: number,
  s: number,
  grow: (i: number) => number = () => 1,
) {
  for (let i = 0; i < puffs.length; i++) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s * 1.12
    g.drawImage(SHADE, ox + (p.x - p.r * 0.08) * s - r, oy + (p.y + p.r * 0.32) * s - r, r * 2, r * 2)
  }
  for (let i = 0; i < puffs.length; i++) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s
    g.drawImage(BODY, ox + p.x * s - r, oy + p.y * s - r, r * 2, r * 2)
  }
  for (let i = 0; i < puffs.length; i += 2) {
    const k = grow(i)
    if (k <= 0) continue
    const p = puffs[i]
    const r = p.r * k * s * 0.5
    g.drawImage(GLOW, ox + (p.x + p.r * 0.2) * s - r, oy + (p.y - p.r * 0.35) * s - r, r * 2, r * 2)
  }
}

/** 다 자란 구름을 캔버스 한 장으로 굽는다. 이후 매 프레임 drawImage 한 번. */
export function bake(puffs: Puff[], res: number) {
  const b = bounds(puffs)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.ceil(w * res))
  cv.height = Math.max(1, Math.ceil(h * res))
  const g = cv.getContext('2d')!
  paintPuffs(g, puffs, -b.minX * res, -b.minY * res, res)
  // 원점(그림 가운데)이 스프라이트 안 어디에 있는지
  return { canvas: cv, w, h, ox: -b.minX, oy: -b.minY }
}

export type Sprite = ReturnType<typeof bake>

/** 구름 스프라이트와 같은 윤곽의 한 가지 색 그림자(종이 위에 떨어지는 그림자용). 작게 구워 가장자리가 부드럽다. */
export function silhouette(sp: Sprite, color: string) {
  const k = 0.25
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.ceil(sp.w * k))
  cv.height = Math.max(1, Math.ceil(sp.h * k))
  const g = cv.getContext('2d')!
  g.drawImage(sp.canvas, 0, 0, cv.width, cv.height)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, cv.width, cv.height)
  return cv
}

export const TAG_FONT = '400 17px Gaegu, "Apple SD Gothic Neo", system-ui, sans-serif'

/** 구름에 실로 매다는 종이 꼬리표. 한 번 구워 두고 매 프레임 그리기만 한다. */
export function makeTag(text: string, res: number) {
  const cv = document.createElement('canvas')
  const g = cv.getContext('2d')!
  g.font = TAG_FONT
  const w = Math.ceil(g.measureText(text).width) + 18
  const h = 30
  cv.width = w * res
  cv.height = h * res
  g.scale(res, res)
  g.fillStyle = '#fffdf7'
  g.beginPath()
  if (g.roundRect) g.roundRect(0.5, 0.5, w - 1, h - 1, 3)
  else g.rect(0.5, 0.5, w - 1, h - 1) // iOS 15 이하 사파리에는 roundRect 가 없다
  g.fill()
  g.fillStyle = '#ac9670'
  g.beginPath()
  g.arc(w / 2, 5.5, 2, 0, Math.PI * 2)
  g.fill()
  g.font = TAG_FONT
  g.fillStyle = '#4b5a6c'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, w / 2, 18.5)
  return cv
}
