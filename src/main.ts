import './style.css'
import { ambientPuffs, bake, bounds, paintPuffs, puffsFromStrokes, resample, rng, type Puff } from './cloud'
import { Pad, type Stroke } from './pad'
import { SharedQueue, sharePts, submitCloud, toStrokes, type SharedCloud } from './shared'

type Sprite = ReturnType<typeof bake>
type Phase = 'morph' | 'rise' | 'arrive' | 'drift' | 'fade'

type Cloud = {
  puffs: Puff[]
  sprite: Sprite | null
  seed: number
  user: boolean
  phase: Phase
  t: number // 현재 단계 경과(초)
  x: number
  y: number
  sx: number // 출발점
  sy: number
  tx: number // 도착점
  ty: number
  depth: number // 0.35(멀리) ~ 1(가까이) = 크기·속도
  alpha: number
  bob: number
  saved?: SavedCloud
  sharedId?: string // 다른 사람 구름
  shownAt?: number
  nick?: string
}

type SavedCloud = { seed: number; depth: number; yf: number; pts: number[][] }

const STORE_KEY = 'sky-doodle:v1'
const MAX_USER = 18
const MORPH = 1.5
const RISE = 3.4
const WIND = 14 // px/s (가까운 구름 기준)
const SHARED_COUNT = 4
const ARRIVE = 7 // 공유 구름이 아래에서 떠오르는 시간(초)
const POLL_MS = 30_000
const NICK_KEY = 'sky-doodle:nick'
const SHARE_KEY = 'sky-doodle:share'

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const sky = document.querySelector<HTMLCanvasElement>('#sky')!
const fx = document.querySelector<HTMLCanvasElement>('#fx')!
const sg = sky.getContext('2d')!
const fg = fx.getContext('2d')!
const book = document.querySelector<HTMLElement>('.book')!
const hint = document.querySelector<HTMLElement>('#hint')!
const sendBtn = document.querySelector<HTMLButtonElement>('#send')!
const clearBtn = document.querySelector<HTMLButtonElement>('#clear')!
const shareBox = document.querySelector<HTMLInputElement>('#share')!
const nickInput = document.querySelector<HTMLInputElement>('#nick')!
const toast = document.querySelector<HTMLElement>('#toast')!
const pad = new Pad(document.querySelector<HTMLCanvasElement>('#pad')!)

let W = 0
let H = 0
let dpr = 1
let bg: HTMLCanvasElement | null = null
const clouds: Cloud[] = []

// ---------- 하늘 바탕 ----------

function paintBackground() {
  const cv = document.createElement('canvas')
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d')!
  g.scale(dpr, dpr)
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#1f6fd1')
  grad.addColorStop(0.45, '#4fa3ec')
  grad.addColorStop(0.8, '#9fd5fb')
  grad.addColorStop(1, '#d9f0ff')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  // 해: 큰 빛무리 + 밝은 원
  const sx = W * 0.84
  const sy = Math.min(H * 0.13, 110)
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.55)
  halo.addColorStop(0, 'rgba(255,250,225,0.75)')
  halo.addColorStop(0.08, 'rgba(255,246,210,0.45)')
  halo.addColorStop(0.35, 'rgba(255,255,255,0.08)')
  halo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#fffdf2'
  g.beginPath()
  g.arc(sx, sy, 34, 0, Math.PI * 2)
  g.fill()

  // 지평선 쪽 옅은 안개
  const haze = g.createLinearGradient(0, H * 0.7, 0, H)
  haze.addColorStop(0, 'rgba(255,255,255,0)')
  haze.addColorStop(1, 'rgba(255,255,255,0.35)')
  g.fillStyle = haze
  g.fillRect(0, H * 0.7, W, H * 0.3)
  bg = cv
}

function resize() {
  W = window.innerWidth
  H = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  for (const cv of [sky, fx]) {
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
  }
  paintBackground()
}

// ---------- 구름 만들기 ----------

function spriteW(c: Cloud) {
  return c.sprite ? c.sprite.w * c.depth : 0
}

function addAmbient(i: number) {
  const seed = 9000 + i * 131
  const r = rng(seed)
  const depth = 0.4 + r() * 0.35
  const puffs = ambientPuffs(seed, 180 + r() * 220)
  const sprite = bake(puffs, dpr)
  const y = H * (0.08 + r() * 0.45)
  clouds.push({
    puffs, sprite, seed, user: false, phase: 'drift', t: 0,
    x: r() * (W + 300) - 150, y, sx: 0, sy: y, tx: 0, ty: y,
    depth, alpha: 0.92, bob: r() * 10,
  })
}

function strokesBox(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of strokes) for (const p of s) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

function sendDrawing() {
  const strokes = pad.getStrokes()
  if (strokes.length === 0) return
  const seed = (Math.random() * 2 ** 31) | 0
  const puffs = puffsFromStrokes(strokes, seed)
  if (puffs.length === 0) return
  const rect = pad.canvas.getBoundingClientRect()
  const { cx, cy } = strokesBox(strokes)
  const r = rng(seed)
  const depth = 0.6 + r() * 0.4
  // 도착 높이: 구름 윗면이 화면 안, 아랫면이 스케치북 위에 오게
  const bb = bounds(puffs)
  const bookTop = book.getBoundingClientRect().top
  const minY = -bb.minY * depth + 14
  const maxY = Math.max(minY, bookTop - bb.maxY * depth - 12)
  const ty = Math.min(maxY, Math.max(minY, H * (0.1 + r() * 0.34)))
  const halfW = ((bb.maxX - bb.minX) / 2) * depth
  const sx = rect.left + cx
  const sy = rect.top + cy
  const saved: SavedCloud = {
    seed,
    depth,
    yf: ty / H,
    pts: strokes.map((s) => resample([s], 4).flatMap((p) => [Math.round(p.x), Math.round(p.y)])),
  }
  clouds.push({
    puffs, sprite: null, seed, user: true, phase: reduceMotion ? 'rise' : 'morph', t: 0,
    x: sx, y: sy, sx, sy,
    tx: Math.min(W - halfW - 10, Math.max(halfW + 10, sx + (r() - 0.5) * W * 0.4)), ty,
    depth, alpha: 1, bob: r() * 10, saved,
  })
  if (reduceMotion) clouds[clouds.length - 1].sprite = bake(puffs, dpr)

  if (shareBox.checked) void share(seed, strokes)

  pad.clear()
  book.classList.add('lift')
  setTimeout(() => book.classList.remove('lift'), 600)

  const users = clouds.filter((c) => c.user && c.phase !== 'fade')
  if (users.length > MAX_USER) {
    users[0].phase = 'fade'
    users[0].t = 0
  }
}

// ---------- 다른 사람 구름 ----------

const sharedQueue = new SharedQueue()

function sharedIds() {
  return clouds.filter((c) => c.sharedId).map((c) => c.sharedId!)
}

/**
 * 승인된 구름 하나를 하늘에 띄운다.
 * - arrive: 스케치북 뒤 아래쪽에서 두둥실 떠올라 자리를 잡는다(delay초 뒤 시작)
 * - enter: 왼쪽 화면 밖에서 바람 타고 들어온다(흘러 나간 구름 자리 채우기)
 */
function addShared(sc: SharedCloud, mode: 'arrive' | 'enter', delay = 0) {
  const strokes = toStrokes(sc.pts)
  let maxDim = 1
  for (const s of strokes) for (const p of s) maxDim = Math.max(maxDim, p.x, p.y)
  // 큰 화면에서 그린 그림도 비슷한 크기로
  const puffs = puffsFromStrokes(strokes, sc.seed, 1.15 * Math.min(1, 260 / maxDim))
  if (puffs.length === 0) return
  const r = rng(sc.seed)
  const depth = 0.5 + r() * 0.2
  const sprite = bake(puffs, dpr)
  const ty = H * (0.1 + r() * 0.4)
  const halfW = (sprite.w / 2) * depth
  const base = {
    puffs, sprite, seed: sc.seed, user: false, tx: 0, ty, depth, bob: r() * 10,
    sharedId: sc.id, nick: sc.nick.trim() || '익명', shownAt: performance.now() + delay * 1000,
  }
  if (mode === 'enter') {
    const x = -(sprite.w - sprite.ox) * depth - 30
    clouds.push({ ...base, phase: 'drift', t: 0, x, y: ty, sx: x, sy: ty, alpha: 0.95 })
    return
  }
  // 바람에 밀려 갈 거리를 빼고 시작해서, 다 떠오를 즈음 화면 안쪽에 오게
  const x = Math.min(W - halfW, Math.max(halfW, halfW + r() * (W - halfW * 2))) - WIND * depth * ARRIVE * 0.5
  const sy = reduceMotion ? ty : H + sprite.oy * depth + 20
  clouds.push({ ...base, phase: 'arrive', t: -delay, x, y: sy, sx: x, sy, alpha: 0 })
}

/** 공유 구름이 꽉 찼으면 가장 오래 떠 있던 것을 스르르 지운다. */
function makeRoom() {
  const live = clouds.filter((c) => c.sharedId && c.phase !== 'fade')
  if (live.length < SHARED_COUNT) return
  live.sort((a, b) => (a.shownAt ?? 0) - (b.shownAt ?? 0))
  live[0].phase = 'fade'
  live[0].t = 0
}

async function startShared() {
  await sharedQueue.fill(SHARED_COUNT + 3, [])
  for (let i = 0; i < SHARED_COUNT; i++) {
    const sc = sharedQueue.next()
    if (!sc) break
    addShared(sc, 'arrive', 0.6 + i * 1.8)
  }
  // 열어 둔 동안 새로 승인된 구름을 띄운다
  window.setInterval(async () => {
    if (document.hidden) return
    const got = await sharedQueue.fresh()
    let k = 0
    for (const sc of got) {
      if (sharedIds().includes(sc.id)) continue
      makeRoom()
      addShared(sc, 'arrive', k++ * 2.5)
    }
  }, POLL_MS)
}

function showToast(text: string) {
  toast.textContent = text
  toast.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('on'), 3200)
}
let toastTimer = 0

async function share(seed: number, strokes: Stroke[]) {
  const result = await submitCloud(seed, sharePts(strokes), nickInput.value)
  const msg = {
    ok: '검수를 거치면 다른 사람 하늘에도 떠요',
    too_many: '오늘은 많이 보냈어요. 이 구름은 내 하늘에만 떠요',
    queue_full: '지금은 공유를 잠시 쉬고 있어요. 내 하늘에는 떠 있어요',
    error: '공유하지 못했어요. 내 하늘에는 떠 있어요',
  }[result]
  showToast(msg)
}

// ---------- 저장 ----------

function save() {
  const data = clouds.filter((c) => c.user && c.saved && c.phase !== 'fade').map((c) => c.saved!)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data))
  } catch {
    /* 저장 공간이 없으면 저장 안 함 */
  }
}

function load() {
  let data: SavedCloud[] = []
  try {
    data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
  } catch {
    return
  }
  if (!Array.isArray(data)) return
  for (const d of data.slice(-MAX_USER)) {
    if (!d || !Array.isArray(d.pts)) continue
    const strokes: Stroke[] = d.pts.map((flat) => {
      const s: Stroke = []
      for (let i = 0; i + 1 < flat.length; i += 2) s.push({ x: Number(flat[i]) || 0, y: Number(flat[i + 1]) || 0 })
      return s
    })
    const puffs = puffsFromStrokes(strokes, d.seed)
    if (puffs.length === 0) continue
    const depth = Math.min(1, Math.max(0.35, Number(d.depth) || 0.8))
    const y = H * Math.min(0.6, Math.max(0.05, Number(d.yf) || 0.3))
    clouds.push({
      puffs, sprite: bake(puffs, dpr), seed: d.seed, user: true, phase: 'drift', t: 0,
      x: Math.random() * W, y, sx: 0, sy: y, tx: 0, ty: y, depth, alpha: 1, bob: Math.random() * 10, saved: d,
    })
  }
}

// ---------- 매 프레임 ----------

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = (t: number) => {
  const c = 1.6
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
}

function drawSprite(g: CanvasRenderingContext2D, c: Cloud, scale: number) {
  const s = c.sprite!
  g.globalAlpha = c.alpha
  g.drawImage(s.canvas, c.x - s.ox * scale, c.y - s.oy * scale, s.w * scale, s.h * scale)
  g.globalAlpha = 1
}

function drawNick(c: Cloud) {
  const s = c.sprite!
  const y = c.y + (s.h - s.oy) * c.depth * 0.82
  sg.globalAlpha = c.alpha * 0.9
  sg.font = '600 12px -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif'
  sg.textAlign = 'center'
  sg.textBaseline = 'top'
  sg.fillStyle = 'rgba(30, 80, 140, 0.35)'
  sg.fillText(c.nick!, c.x + 0.5, y + 1)
  sg.fillStyle = '#ffffff'
  sg.fillText(c.nick!, c.x, y)
  sg.globalAlpha = 1
}

let last = performance.now()
let elapsed = 0

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  elapsed += dt

  sg.setTransform(dpr, 0, 0, dpr, 0, 0)
  fg.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (bg) sg.drawImage(bg, 0, 0, W, H)
  else sg.clearRect(0, 0, W, H)
  fg.clearRect(0, 0, W, H)

  let changed = false
  // 멀리 있는 구름부터
  clouds.sort((a, b) => a.depth - b.depth)

  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]
    c.t += dt
    if (c.phase === 'morph') {
      // 선을 따라 덩어리가 차례로 부풀어 오른다
      const n = c.puffs.length
      const grow = (k: number) => {
        const start = (k / n) * (MORPH * 0.6)
        const t = (c.t - start) / (MORPH * 0.4)
        return t <= 0 ? 0 : t >= 1 ? 1 : easeOutBack(t)
      }
      paintPuffs(fg, c.puffs, c.x, c.y, 1, grow)
      if (c.t >= MORPH) {
        c.sprite = bake(c.puffs, dpr)
        c.phase = 'rise'
        c.t = 0
      }
      continue
    }
    if (c.phase === 'rise') {
      const dur = reduceMotion ? 1.2 : RISE
      const k = easeInOut(Math.min(1, c.t / dur))
      c.x = c.sx + (c.tx - c.sx) * k
      c.y = c.sy + (c.ty - c.sy) * k
      const scale = 1 + (c.depth - 1) * k
      drawSprite(fg, c, scale)
      if (c.t >= dur) {
        c.phase = 'drift'
        c.t = 0
        changed = true
      }
      continue
    }
    const bobY = reduceMotion ? 0 : Math.sin(elapsed * 0.35 + c.bob) * 5 * c.depth
    if (c.phase === 'arrive') {
      if (c.t < 0) continue
      const k = Math.min(1, c.t / (reduceMotion ? 1.5 : ARRIVE))
      const e = easeOutCubic(k)
      c.x += WIND * c.depth * dt
      c.y = c.sy + (c.ty - c.sy) * e
      c.alpha = 0.95 * Math.min(1, k * 2.5)
      // 올라오는 동안 살랑살랑, 다 올라오면 평소의 위아래 흔들림으로 이어진다
      const sway = reduceMotion ? 0 : Math.sin(c.t * 1.4 + c.bob) * 7 * (1 - e)
      const x0 = c.x
      const y0 = c.y
      c.x += sway
      c.y += bobY * e
      drawSprite(sg, c, c.depth * (0.85 + 0.15 * e))
      if (c.nick) drawNick(c)
      c.x = x0
      c.y = y0
      if (k >= 1) {
        c.phase = 'drift'
        c.t = 0
      }
      continue
    }
    // drift / fade
    c.x += WIND * c.depth * dt
    const w = spriteW(c)
    const left = c.x - (c.sprite ? c.sprite.ox * c.depth : 0)
    if (left > W + 20) {
      const next = c.sharedId ? sharedQueue.next() : undefined
      if (next) {
        clouds.splice(i, 1)
        addShared(next, 'enter')
        void sharedQueue.fill(SHARED_COUNT, sharedIds())
        continue
      }
      c.x -= W + w + 40
      if (c.sharedId) void sharedQueue.fill(SHARED_COUNT, sharedIds())
    }
    if (c.phase === 'fade') {
      c.alpha = Math.min(c.alpha, Math.max(0, 1 - c.t / 2.5))
      if (c.alpha === 0) {
        clouds.splice(i, 1)
        changed = true
        continue
      }
    }
    const y0 = c.y
    c.y = y0 + bobY
    drawSprite(sg, c, c.depth)
    if (c.nick) drawNick(c)
    c.y = y0
  }

  if (changed) save()
  requestAnimationFrame(frame)
}

// ---------- 시작 ----------

pad.onChange = (has) => {
  sendBtn.disabled = !has
  hint.classList.toggle('off', has)
}
sendBtn.addEventListener('click', sendDrawing)
try {
  nickInput.value = localStorage.getItem(NICK_KEY) ?? ''
  shareBox.checked = localStorage.getItem(SHARE_KEY) !== '0'
} catch {
  /* 저장소를 못 쓰면 기본값 */
}
const syncShare = () => {
  nickInput.hidden = !shareBox.checked
  try {
    localStorage.setItem(SHARE_KEY, shareBox.checked ? '1' : '0')
    localStorage.setItem(NICK_KEY, nickInput.value.trim())
  } catch {
    /* 무시 */
  }
}
shareBox.addEventListener('change', syncShare)
nickInput.addEventListener('change', syncShare)
nickInput.hidden = !shareBox.checked
clearBtn.addEventListener('click', () => pad.clear())

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    const oldH = H
    resize()
    for (const c of clouds) {
      c.y = (c.y / oldH) * H
      c.ty = (c.ty / oldH) * H
    }
  }, 120)
})

resize()
for (let i = 0; i < 6; i++) addAmbient(i)
load()
void startShared()
requestAnimationFrame(frame)
