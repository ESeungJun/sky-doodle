/** 움직이지 않는 하늘 층(#bg): 지금 시각의 하늘빛, 해나 달, 별, 지평선 안개. 크기·시각이 바뀔 때만 다시 그린다. */
import { rng } from './geom.ts'
import { daySeed, SKY_STOPS, skyAt, type SkyTone } from './skytone.ts'

export function paintBackdrop(canvas: HTMLCanvasElement, W: number, H: number, dpr: number): SkyTone {
  const now = new Date()
  const tone = skyAt(now.getHours() + now.getMinutes() / 60)
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  const g = canvas.getContext('2d')!
  g.scale(dpr, dpr)
  const grad = g.createLinearGradient(0, 0, 0, H)
  tone.stops.forEach((c, i) => grad.addColorStop(SKY_STOPS[i], c))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  if (tone.stars > 0.05) {
    const r = rng(daySeed(now))
    g.fillStyle = '#ffffff'
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = tone.stars * (0.25 + r() * 0.6)
      g.beginPath()
      g.arc(r() * W, r() * H * 0.62, 0.5 + r() * 0.9, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  }

  // 해(밤에는 달): 큰 빛무리 + 밝은 원
  const sx = W * 0.84
  const sy = Math.min(H * 0.13, 110)
  const rgb = [1, 3, 5].map((i) => parseInt(tone.glow.slice(i, i + 2), 16)).join(',')
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.55)
  const lit = tone.moon ? 0.45 : 1
  halo.addColorStop(0, `rgba(${rgb},${0.75 * lit})`)
  halo.addColorStop(0.08, `rgba(${rgb},${0.45 * lit})`)
  halo.addColorStop(0.35, `rgba(${rgb},${0.08 * lit})`)
  halo.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = halo
  g.fillRect(0, 0, W, H)
  g.fillStyle = tone.disc
  g.beginPath()
  g.arc(sx, sy, tone.moon ? 26 : 34, 0, Math.PI * 2)
  g.fill()

  // 지평선 쪽 옅은 안개
  const haze = g.createLinearGradient(0, H * 0.7, 0, H)
  haze.addColorStop(0, 'rgba(255,255,255,0)')
  haze.addColorStop(1, `rgba(255,255,255,${0.35 * (1 - tone.dusk)})`)
  g.fillStyle = haze
  g.fillRect(0, H * 0.7, W, H * 0.3)

  // 브라우저 테두리 색과, 캔버스가 그려지기 전 바탕색도 하늘빛에 맞춘다
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tone.stops[1])
  document.documentElement.style.backgroundColor = tone.stops[1]
  return tone
}
