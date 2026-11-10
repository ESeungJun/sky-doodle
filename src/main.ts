import './fonts.css'
import './style.css'
import { paintBackdrop } from './backdrop.ts'
import { bake, makeTag, paintPuffs, silhouette, TAG_FONT, type Sprite } from './cloud.ts'
import { setupDesk } from './desk.ts'
import { canShareFiles, cloudPng, download, shareOrDownload } from './export.ts'
import { ambientPuffs, bounds, flatten, girth, layoutCloud, puffsFromStrokes, rng, sharedScale, toStrokes, type Puff, type Stroke } from './geom.ts'
import { setupNote } from './note.ts'
import { Pad } from './pad.ts'
import { approvedOf, nextPollDelay, SharedQueue, sharePts, shouldPoll, submitCloud, type SharedCloud } from './shared.ts'
import { daySeed, skyAt, type SkyTone } from './skytone.ts'
import { KEYS, sentIds, store } from './store.ts'

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
  depth: number // 0.3(멀리) ~ 1(가까이) = 크기·속도
  alpha: number
  bob: number
  vx: number // 손으로 민 속도(px/s). 바람 속도에 더해지고 점점 줄어든다
  saved?: SavedCloud
  sharedId?: string // 다른 사람 구름
  shownAt?: number
  tag?: HTMLCanvasElement // 이름 꼬리표
  // 종이에서 떠오르는 동안만
  ghost?: Stroke[] // 그린 선(구름 가운데 기준)
  shadow?: HTMLCanvasElement
  rot?: number // 종이가 기운 각도
  blown?: number // 오르는 동안 바람에 밀린 거리
}

/** at: 보낸 시각, w: 그린 종이 폭(px), ws: 획마다 붓 굵기 */
type SavedCloud = { seed: number; depth: number; yf: number; pts: number[][]; w?: number; ws?: number[]; at?: number }

const MAX_USER = 18
const LINE = 0.3 // 선이 흰색으로 굵어지는 시간(초)
const MORPH = 1.7 // 선 → 구름 전체
const RISE = 3.4
const WIND = 14 // px/s (가까운 구름 기준)
const SHARED_COUNT = 4
const ARRIVE = 7 // 공유 구름이 아래에서 떠오르는 시간(초)

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const bgCanvas = $<HTMLCanvasElement>('#bg')
const sky = $<HTMLCanvasElement>('#sky')
const fx = $<HTMLCanvasElement>('#fx')
const sg = sky.getContext('2d')!
const fg = fx.getContext('2d')!
const book = $('.book')
const hint = $('#hint')
const sendBtn = $<HTMLButtonElement>('#send')
const undoBtn = $<HTMLButtonElement>('#undo')
const shareBox = $<HTMLInputElement>('#share')
const shareRow = $('#sharebox')
const nameTag = $<HTMLButtonElement>('#nametag')
const slip = $('#slip')
const sr = $('#sr')
const toast = $('#toast')
const pad = new Pad($<HTMLCanvasElement>('#pad'))

let W = 0
let H = 0
let dpr = 1
let tone: SkyTone = skyAt(12)
const clouds: Cloud[] = []

// ---------- 하늘 바탕 ----------

function resize() {
  W = window.innerWidth
  H = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  for (const cv of [sky, fx]) {
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
  }
  tone = paintBackdrop(bgCanvas, W, H, dpr)
}

// ---------- 구름 만들기 ----------

/** 멀리 있는 구름부터 그리도록 깊이 순서를 지켜 넣는다(매 프레임 정렬하지 않으려고) */
function addCloud(c: Cloud) {
  let i = clouds.length
  while (i > 0 && clouds[i - 1].depth > c.depth) i--
  clouds.splice(i, 0, c)
}

function addAmbient(i: number, far: boolean) {
  const seed = daySeed(new Date()) * 7 + i * 131 // 하루 동안은 같은 하늘, 다음 날은 다른 하늘
  const r = rng(seed)
  const depth = far ? 0.3 + r() * 0.08 : 0.4 + r() * 0.35
  const puffs = ambientPuffs(seed, far ? 150 + r() * 120 : 180 + r() * 220)
  const y = H * (far ? 0.42 + r() * 0.16 : 0.08 + r() * 0.45)
  addCloud({
    puffs, sprite: bake(puffs, dpr), seed, user: false, phase: 'drift', t: 0,
    x: r() * (W + 300) - 150, y, sx: 0, sy: y, tx: 0, ty: y,
    depth, alpha: far ? 0.72 : 0.92, bob: r() * 10, vx: 0,
  })
}

/** 스케치북이 기운 각도(라디안). 들썩이는 동안에는 그 순간의 값. */
function bookTilt() {
  const m = new DOMMatrixReadOnly(getComputedStyle(book).transform)
  return Math.atan2(m.b, m.a)
}
pad.tilt = bookTilt

/** 종이 위 좌표 → 화면 좌표 */
function paperToScreen(x: number, y: number, tilt = bookTilt()) {
  const r = pad.canvas.getBoundingClientRect()
  const dx = x - pad.canvas.offsetWidth / 2
  const dy = y - pad.canvas.offsetHeight / 2
  return {
    x: r.left + r.width / 2 + dx * Math.cos(tilt) - dy * Math.sin(tilt),
    y: r.top + r.height / 2 + dx * Math.sin(tilt) + dy * Math.cos(tilt),
  }
}

// style.css 의 가로 폰 규칙과 같은 조건: 스케치북이 오른쪽에 서 있는 배치
const SIDE_BOOK = matchMedia('(max-height: 500px) and (orientation: landscape)')

function sendDrawing() {
  const strokes = pad.getStrokes()
  if (strokes.length === 0) return
  const seed = (Math.random() * 2 ** 31) | 0
  const { puffs, cx, cy } = layoutCloud(strokes, seed)
  if (puffs.length === 0) return
  const rot = bookTilt()
  const from = paperToScreen(cx, cy, rot)
  const r = rng(seed)
  const depth = 0.6 + r() * 0.4
  // 도착 높이: 구름 윗면이 화면 안, 아랫면이 스케치북 위에 오게
  const bb = bounds(puffs)
  const br = book.getBoundingClientRect()
  // 가로 폰에서는 스케치북이 오른쪽에 서 있다: 높이 제한 대신 스케치북 왼쪽 하늘로 보낸다
  const side = SIDE_BOOK.matches
  const minY = -bb.minY * depth + 14
  const maxY = Math.max(minY, (side ? H * 0.8 : br.top) - bb.maxY * depth - 12)
  const ty = Math.min(maxY, Math.max(minY, H * (0.1 + r() * 0.34)))
  const halfW = ((bb.maxX - bb.minX) / 2) * depth
  const rightX = side ? Math.max(halfW + 10, br.left - 10) : W
  const wish = side ? rightX * (0.25 + r() * 0.5) : from.x + (r() - 0.5) * W * 0.4
  const padW = pad.canvas.offsetWidth
  const saved: SavedCloud = {
    seed,
    depth,
    yf: ty / H,
    w: Math.round(padW),
    pts: flatten(strokes, 4),
    ws: strokes.map((s) => s.w),
    at: Date.now(),
  }
  const sprite = bake(puffs, dpr)
  addCloud({
    puffs, sprite, seed, user: true, phase: reduceMotion ? 'rise' : 'morph', t: 0,
    x: from.x, y: from.y, sx: from.x, sy: from.y,
    tx: Math.min(rightX - halfW - 10, Math.max(halfW + 10, wish)), ty,
    depth, alpha: 1, bob: r() * 10, vx: 0, saved,
    ghost: strokes.map((s) => ({ w: s.w, pts: s.pts.map((p) => ({ x: p.x - cx, y: p.y - cy })) })),
    shadow: silhouette(sprite, '#3f5f8c'),
    rot, blown: 0,
  })
  if (reduceMotion) liftBook()

  if (shareBox.checked) void share(seed, strokes)
  else if (!asked()) whenCalm(() => openAsk({ seed, strokes }))
  sr.textContent = '구름을 하늘로 보냈어요'

  // 선은 지우지만 같은 자리에서 #fx 가 이어 그린다: 선이 사라지지 않고 구름이 된다
  desk.forgetTurned()
  holdHint = true
  pad.clear()
  hint.classList.add('again')
  whenCalm(() => {
    holdHint = false
    hint.classList.toggle('off', pad.hasInk)
  })
  navigator.vibrate?.(12)

  // 18개를 넘으면 가장 오래된 구름부터 보낸다
  const users = clouds.filter((c) => c.user && c.phase !== 'fade')
  if (users.length > MAX_USER) {
    const oldest = users.reduce((a, b) => ((a.saved?.at ?? 0) <= (b.saved?.at ?? 0) ? a : b))
    oldest.phase = 'fade'
    oldest.t = 0
    if (oldest === picked) closeSlip()
  }
  // 오르는 5초 사이에 탭을 닫아도 구름이 남도록 바로 저장한다
  save()
}

function liftBook() {
  book.classList.add('lift')
  setTimeout(() => book.classList.remove('lift'), 600)
}

// ---------- 한 번에 주인공은 하나: 구름이 오르는 동안 쪽지·알림은 기다린다 ----------

let holdHint = false // 구름이 종이를 떠날 때까지 '그려 보세요' 안내를 미룬다
const calmQueue: (() => void)[] = []
const rising = () => clouds.some((c) => c.phase === 'morph' || c.phase === 'rise')
function whenCalm(fn: () => void) {
  if (rising()) calmQueue.push(fn)
  else fn()
}

let toastTimer = 0
function showToast(text: string) {
  whenCalm(() => {
    toast.textContent = text
    toast.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('on'), 3600)
  })
}

// ---------- 쪽지: 첫 전송 뒤 공유 묻기, 이름 적기 ----------

type Job = { seed: number; strokes: Stroke[] }

const asked = () => store.get(KEYS.asked) === '1'
function markAsked() {
  store.set(KEYS.asked, '1')
  shareRow.hidden = false
}
function setNick(v: string) {
  const nick = [...v.trim()].slice(0, 10).join('')
  store.set(KEYS.nick, nick)
  nameTag.textContent = nick ? `이름표: ${nick}` : '이름표: 안 씀'
}
function setSharing(on: boolean) {
  shareBox.checked = on
  nameTag.hidden = !on
  store.set(KEYS.share, on ? '1' : '0')
}

/** 쪽지가 닫힌 뒤 초점을 둘 곳: 늘 살아 있는 연필꽂이의 고른 도구. 쪽지 안에 초점이 있었을 때만 옮긴다 */
function focusDesk() {
  if (document.activeElement && document.activeElement !== document.body) return
  document.querySelector<HTMLElement>('#tools .tool[aria-checked="true"]')?.focus()
}

let kb = 0 // 화면 키보드 높이(px)
const note = setupNote<Job>({
  nick: () => store.get(KEYS.nick) ?? '',
  setNick,
  keyboardUp: () => kb > 0,
  place(w, h, typing, job) {
    const br = book.getBoundingClientRect()
    let left: number
    let bottom: number
    let right = false
    if (typing) {
      // 화면 키보드 바로 위
      left = (W - w) / 2
      bottom = kb + 10
    } else if (SIDE_BOOK.matches) {
      left = Math.max(12, br.left - w - 4)
      bottom = 28
    } else {
      // 스케치북 위쪽 가장자리에 테이프로 붙인 자리. 묻고 있는 구름을 가리지 않는 쪽에 붙인다
      const mine = clouds.find((c) => c.user && c.seed === job?.seed)
      right = !!mine && mine.x <= br.left + br.width / 2
      left = right ? br.right - w - 14 : Math.max(12, br.left + 14)
      bottom = Math.max(12, H - br.top - 30)
    }
    return { left: Math.max(8, Math.min(left, W - w - 8)), bottom: Math.min(bottom, H - h - 8), right }
  },
  accept(job) {
    markAsked()
    setSharing(true)
    void share(job.seed, job.strokes)
    focusDesk()
  },
  decline() {
    markAsked()
    setSharing(false)
    showToast('내 하늘에만 띄울게요. 아래에서 언제든 바꿀 수 있어요')
    focusDesk()
  },
  closed: () => nameTag.focus(),
})

function openAsk(job: Job) {
  if (asked() || note.open) return
  note.ask(job)
  sr.textContent = '이 구름을 다른 사람 하늘에도 띄울지 묻는 쪽지가 붙었어요. 스케치북 다음에 있어요'
}
nameTag.addEventListener('click', () => note.editName())
shareBox.addEventListener('change', () => setSharing(shareBox.checked))

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
  const puffs = puffsFromStrokes(strokes, sc.seed, sharedScale(strokes))
  if (puffs.length === 0) return
  const r = rng(sc.seed)
  const depth = 0.5 + r() * 0.2
  const sprite = bake(puffs, dpr)
  const ty = H * (0.1 + r() * 0.4)
  const halfW = (sprite.w / 2) * depth
  const base = {
    puffs, sprite, seed: sc.seed, user: false, tx: 0, ty, depth, bob: r() * 10, vx: 0,
    sharedId: sc.id, shownAt: performance.now() + delay * 1000,
  }
  let c: Cloud
  if (mode === 'enter') {
    const x = -(sprite.w - sprite.ox) * depth - 30
    c = { ...base, phase: 'drift', t: 0, x, y: ty, sx: x, sy: ty, alpha: 0.95 }
  } else {
    // 바람에 밀려 갈 거리를 빼고 시작해서, 다 떠오를 즈음 화면 안쪽에 오게
    const x = Math.min(W - halfW, Math.max(halfW, halfW + r() * (W - halfW * 2))) - WIND * depth * ARRIVE * 0.5
    const sy = reduceMotion ? ty : H + sprite.oy * depth + 20
    c = { ...base, phase: 'arrive', t: -delay, x, y: sy, sx: x, sy, alpha: 0 }
  }
  addCloud(c)
  // 손글씨 글꼴에 없는 글자는 시스템 글꼴로 나온다. 글꼴을 받지 못해도 꼬리표는 단다
  const nick = sc.nick.trim() || '익명'
  const hang = () => { c.tag = makeTag(nick, dpr) }
  document.fonts.load(TAG_FONT, nick).then(hang, hang)
}

/** 공유 구름이 꽉 찼으면 가장 오래 떠 있던 것을 스르르 지운다. */
function makeRoom() {
  const live = clouds.filter((c) => c.sharedId && c.phase !== 'fade')
  if (live.length < SHARED_COUNT) return
  live.sort((a, b) => (a.shownAt ?? 0) - (b.shownAt ?? 0))
  live[0].phase = 'fade'
  live[0].t = 0
}

/** 운영자가 내린 구름을 열려 있는 화면에서 뺀다 */
function dropGone(ids: string[]) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]
    if (!c.sharedId || !ids.includes(c.sharedId)) continue
    if (c.phase === 'arrive' && c.t < 0) clouds.splice(i, 1) // 아직 보이기 전
    else if (c.phase !== 'fade') {
      c.phase = 'fade'
      c.t = 0
    }
  }
}

// 새 구름 확인: 없으면 30초 → 60초 → 120초로 늘리고, 화면이 가려지거나 5분 동안 조작이 없으면 쉰다
let lastInput = Date.now()
let emptyStreak = 0
let pollTimer = 0
let pollPaused = false

async function poll() {
  if (!shouldPoll(document.hidden, Date.now() - lastInput)) {
    pollPaused = true
    return
  }
  const { clouds: got, gone } = await sharedQueue.fresh()
  dropGone(gone)
  let k = 0
  for (const sc of got) {
    if (sharedIds().includes(sc.id)) continue
    makeRoom()
    addShared(sc, 'arrive', k++ * 2.5)
  }
  // 처음 받아 오기에 실패했거나 구름이 내려가 자리가 비었으면 대기 줄에서 채운다
  for (let room = SHARED_COUNT - clouds.filter((c) => c.sharedId && c.phase !== 'fade').length; room > 0; room--) {
    const sc = sharedQueue.next(sharedIds())
    if (!sc) break
    addShared(sc, 'arrive', k++ * 2.5)
  }
  emptyStreak = got.length || gone.length ? 0 : emptyStreak + 1
  pollTimer = window.setTimeout(poll, nextPollDelay(emptyStreak))
}

function wake() {
  lastInput = Date.now()
  if (!pollPaused || document.hidden) return
  pollPaused = false
  emptyStreak = 0
  clearTimeout(pollTimer)
  pollTimer = window.setTimeout(poll, 1500)
}
for (const ev of ['pointerdown', 'keydown', 'focus'] as const) window.addEventListener(ev, wake, { passive: true })
document.addEventListener('visibilitychange', wake)

async function startShared() {
  await sharedQueue.fill(SHARED_COUNT + 3, [])
  for (let i = 0; i < SHARED_COUNT; i++) {
    const sc = sharedQueue.next(sharedIds())
    if (!sc) break
    addShared(sc, 'arrive', 0.6 + i * 1.8)
  }
  pollTimer = window.setTimeout(poll, nextPollDelay(0))
}

async function share(seed: number, strokes: Stroke[]) {
  const res = await submitCloud(seed, sharePts(strokes), store.get(KEYS.nick) ?? '')
  if (res.result === 'ok' && res.id) store.set(KEYS.sent, JSON.stringify([...sentIds(), res.id].slice(-20)))
  showToast({
    ok: '확인이 끝나면 다른 사람 하늘에도 떠요',
    too_many: '오늘은 많이 보냈어요. 이 구름은 내 하늘에만 떠요',
    queue_full: '지금은 구름이 너무 많이 밀려 있어요. 내 하늘에는 떠 있어요',
    error: '다른 하늘로 보내지 못했어요. 내 하늘에는 떠 있어요',
  }[res.result])
}

/** 지난번에 보낸 구름이 승인됐으면 한 번 알려 준다 */
async function tellApproved() {
  const ids = sentIds()
  if (ids.length === 0) return
  const ok = await approvedOf(ids)
  if (ok.length === 0) return
  // 기다리는 사이 새로 보낸 것이 있을 수 있으니 지금 목록에서 뺀다
  store.set(KEYS.sent, JSON.stringify(sentIds().filter((id) => !ok.includes(id))))
  showToast('지난번 구름이 다른 사람 하늘에도 떠 있어요')
}

// ---------- 저장 ----------

function save() {
  const data = clouds
    .filter((c) => c.user && c.saved && c.phase !== 'fade')
    .map((c) => c.saved!)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  store.set(KEYS.clouds, JSON.stringify(data))
}

function load() {
  let data: SavedCloud[] = []
  try {
    data = JSON.parse(store.get(KEYS.clouds) || '[]')
  } catch {
    return
  }
  if (!Array.isArray(data)) return
  data.slice(-MAX_USER).forEach((d, i) => {
    if (!d || !Array.isArray(d.pts)) return
    const strokes = toStrokes(d.pts, Array.isArray(d.ws) ? d.ws : undefined)
    // 다른 크기 화면(예: PC)에서 그린 구름이 폰 하늘을 덮지 않게 지금 종이 폭에 맞춰 줄인다
    let maxX = 1
    for (const s of strokes) for (const p of s.pts) maxX = Math.max(maxX, p.x)
    const padW = pad.canvas.offsetWidth || W
    const k = Math.min(1, padW / Math.max(Number(d.w) || 0, maxX))
    const puffs = puffsFromStrokes(strokes, d.seed, 1.15 * k)
    if (puffs.length === 0) return
    const depth = Math.min(1, Math.max(0.35, Number(d.depth) || 0.8))
    const y = H * Math.min(0.6, Math.max(0.05, Number(d.yf) || 0.3))
    // 예전 저장분에는 보낸 시각이 없다: 저장된 순서를 시각 삼는다
    if (typeof d.at !== 'number') d.at = i
    addCloud({
      puffs, sprite: bake(puffs, dpr), seed: d.seed, user: true, phase: 'drift', t: 0,
      x: Math.random() * W, y, sx: 0, sy: y, tx: 0, ty: y, depth, alpha: 1, bob: Math.random() * 10, vx: 0, saved: d,
    })
  })
}

// ---------- 매 프레임 ----------

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = (t: number) => {
  const c = 1.6
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
}
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

function drawSprite(g: CanvasRenderingContext2D, c: Cloud, scale: number) {
  const s = c.sprite!
  g.globalAlpha = c.alpha * (1 - tone.dusk * 0.4) // 밤에는 구름이 하늘빛에 잠긴다
  g.drawImage(s.canvas, c.x - s.ox * scale, c.y - s.oy * scale, s.w * scale, s.h * scale)
  g.globalAlpha = 1
}

/** 구름 아래로 실이 내려와 꼬리표가 달린다. 구름과 함께 살짝 흔들린다. */
function drawTag(c: Cloud) {
  const s = c.sprite!
  const top = c.y + (s.h - s.oy) * c.depth * 0.72
  const w = c.tag!.width / dpr
  const h = c.tag!.height / dpr
  sg.save()
  sg.globalAlpha = c.alpha
  sg.translate(c.x, top)
  sg.rotate(reduceMotion ? 0 : Math.sin(elapsed * 0.6 + c.bob) * 0.06)
  sg.strokeStyle = 'rgba(255,255,255,0.8)'
  sg.lineWidth = 1
  sg.beginPath()
  sg.moveTo(0, 0)
  sg.lineTo(0, 18)
  sg.stroke()
  sg.drawImage(c.tag!, -w / 2, 12, w, h)
  sg.restore()
}

/** 종이 위(기운 사각형) 안에만 그리도록 자른다: 그림자는 종이에 떨어진다 */
function clipToPaper(g: CanvasRenderingContext2D, tilt: number) {
  const w = pad.canvas.offsetWidth
  const h = pad.canvas.offsetHeight
  g.beginPath()
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    const p = paperToScreen(x, y, tilt)
    g.lineTo(p.x, p.y)
  }
  g.closePath()
  g.clip()
}

/** 종이에 떨어지는 구름 그림자. lift 0(종이에 붙음) ~ 1(멀리 떠남): 멀어질수록 작고 흐리고 빛 반대쪽으로 밀린다 */
function drawPaperShadow(c: Cloud, lift: number, strength: number) {
  const s = c.sprite!
  const a = 0.34 * strength * clamp01(1 - lift * 1.5)
  if (a <= 0.004) return
  const k = 1 - 0.3 * lift
  fg.save()
  clipToPaper(fg, c.rot ?? 0)
  fg.globalAlpha = a
  fg.translate(c.sx - 6 - 46 * lift, c.sy + 9 + 70 * lift)
  fg.rotate(c.rot ?? 0)
  fg.drawImage(c.shadow!, -s.ox * k, -s.oy * k, s.w * k, s.h * k)
  fg.restore()
}

/** 연필 선이 흰색으로 바뀌며 굵어진다(e: 0 연필 선 → 1 구름 굵기) */
function drawGhost(c: Cloud, e: number, alpha: number) {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * e)
  fg.save()
  fg.translate(c.x, c.y)
  fg.rotate(c.rot ?? 0)
  const s = 1 + 0.15 * e
  fg.scale(s, s)
  fg.globalAlpha = alpha
  fg.strokeStyle = fg.fillStyle = `rgb(${mix(75, 250)},${mix(90, 252)},${mix(108, 255)})`
  fg.lineCap = 'round'
  fg.lineJoin = 'round'
  fg.shadowColor = `rgba(63,95,140,${0.4 * e})`
  fg.shadowBlur = 8
  fg.shadowOffsetY = 3
  for (const st of c.ghost!) {
    const w = st.w + (20 * girth(st.w) - st.w) * e
    fg.lineWidth = w
    fg.beginPath()
    if (st.pts.length === 1) {
      fg.arc(st.pts[0].x, st.pts[0].y, w / 2, 0, Math.PI * 2)
      fg.fill()
      continue
    }
    fg.moveTo(st.pts[0].x, st.pts[0].y)
    for (let i = 1; i < st.pts.length; i++) fg.lineTo(st.pts[i].x, st.pts[i].y)
    fg.stroke()
  }
  fg.restore()
}

let last = performance.now()
let elapsed = 0
let fxDirty = false

function frame(now: number) {
  requestAnimationFrame(frame)
  // 가만히 흘러가기만 할 때는 초당 30번이면 충분하다(초당 14px)
  // 화면 주사율과 상관없게 프레임 번호가 아니라 지난 시간으로 건너뛴다
  const lively = clouds.some((c) => c.phase !== 'drift' || c.vx !== 0) || grab !== null
  if (!lively && now - last < 30) return
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  elapsed += dt

  sg.setTransform(dpr, 0, 0, dpr, 0, 0)
  sg.clearRect(0, 0, W, H)
  const fxLive = rising()
  if (fxLive || fxDirty) {
    fg.setTransform(dpr, 0, 0, dpr, 0, 0)
    fg.clearRect(0, 0, W, H)
    fxDirty = fxLive
  }

  let changed = false
  const incoming: SharedCloud[] = [] // 나간 공유 구름 자리에 들일 것. 도는 중에 배열에 끼워 넣지 않으려고 모아 둔다
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i]
    c.t += dt
    if (c.phase === 'morph') {
      // 선이 희어지며 굵어지고, 그 위로 덩어리가 선을 따라 차례로 부풀어 오른다
      const line = easeOutCubic(clamp01(c.t / LINE))
      const n = c.puffs.length
      const grow = (k: number) => {
        const start = LINE * 0.6 + (k / n) * (MORPH - LINE) * 0.55
        const t = (c.t - start) / ((MORPH - LINE) * 0.42)
        return t <= 0 ? 0 : t >= 1 ? 1 : easeOutBack(t)
      }
      drawPaperShadow(c, 0, clamp01(c.t / (MORPH * 0.7)))
      drawGhost(c, line, clamp01((MORPH - c.t) / (MORPH * 0.35)))
      fg.save()
      fg.translate(c.x, c.y)
      fg.rotate(c.rot ?? 0)
      paintPuffs(fg, c.puffs, 0, 0, 1, grow)
      fg.restore()
      if (c.t >= MORPH) {
        c.phase = 'rise'
        c.t = 0
        liftBook()
      }
      continue
    }
    if (c.phase === 'rise') {
      const dur = reduceMotion ? 1.2 : RISE
      const k = clamp01(c.t / dur)
      const e = easeInOut(k)
      // 위로 먼저 오르고 옆으로는 뒤늦게 밀린다: 바람 쪽으로 휘는 길. 끝 속도는 바람 속도와 같다
      c.blown = (c.blown ?? 0) + WIND * c.depth * dt * e
      c.x = c.sx + (c.tx - c.sx) * e * e + c.blown
      // 끝으로 갈수록 흘러갈 때의 위아래 흔들림을 섞어, 자리 잡는 순간 튀지 않게 한다
      c.y = c.sy + (c.ty - c.sy) * e + (reduceMotion ? 0 : Math.sin(elapsed * 0.35 + c.bob) * 5 * c.depth * e)
      drawPaperShadow(c, easeOutCubic(k), 1)
      const scale = 1 + (c.depth - 1) * e
      // 떠나는 순간 살짝 눌렸다가 늘어난다
      let squash = 1
      if (!reduceMotion) {
        if (c.t < 0.16) squash = 1 - 0.06 * (c.t / 0.16)
        else if (c.t < 0.44) squash = 0.94 + 0.1 * ((c.t - 0.16) / 0.28)
        else if (c.t < 0.9) squash = 1.04 - 0.04 * ((c.t - 0.44) / 0.46)
      }
      const s = c.sprite!
      fg.save()
      fg.translate(c.x, c.y)
      fg.rotate((c.rot ?? 0) * (1 - easeOutCubic(clamp01(c.t / 0.7))))
      fg.scale(scale / Math.sqrt(squash), scale * squash)
      fg.globalAlpha = c.alpha
      fg.drawImage(s.canvas, -s.ox, -s.oy, s.w, s.h)
      fg.restore()
      if (c.t >= dur) {
        c.phase = 'drift'
        c.t = 0
        c.y = c.ty
        c.ghost = c.shadow = undefined
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
      if (c.tag) drawTag(c)
      c.x = x0
      c.y = y0
      if (k >= 1) {
        c.phase = 'drift'
        c.t = 0
      }
      continue
    }
    // drift / fade. 고른 구름은 쪽지가 달려 있는 동안 제자리에 머문다
    const held = c === picked
    if (!held) c.x += (WIND * c.depth + c.vx) * dt
    if (c.vx !== 0) {
      c.vx *= Math.exp(-dt * 1.4)
      if (Math.abs(c.vx) < 2) c.vx = 0
    }
    const s = c.sprite!
    const w = s.w * c.depth
    const left = c.x - s.ox * c.depth
    if (left > W + 20) {
      const next = c.sharedId ? sharedQueue.next([...sharedIds(), ...incoming.map((n) => n.id)]) : undefined
      if (next) {
        clouds.splice(i--, 1)
        incoming.push(next)
        void sharedQueue.fill(SHARED_COUNT, sharedIds())
        continue
      }
      c.x -= W + w + 40
      if (c.sharedId) void sharedQueue.fill(SHARED_COUNT, sharedIds())
    } else if (left + w < -20 && c.vx < 0) {
      c.x += W + w + 40 // 왼쪽으로 밀려 나가면 오른쪽에서 돌아온다
    }
    if (c.phase === 'fade') {
      c.alpha = Math.min(c.alpha, Math.max(0, 1 - c.t / 2.5))
      if (c.alpha === 0) {
        if (c === picked) closeSlip()
        clouds.splice(i--, 1)
        changed = true
        continue
      }
    }
    const y0 = c.y
    c.y = y0 + bobY
    drawSprite(sg, c, c.depth * (held ? 1.06 : 1))
    if (c.tag) drawTag(c)
    c.y = y0
  }

  for (const sc of incoming) addShared(sc, 'enter')
  if (changed) save()
  if (calmQueue.length && !rising()) for (const fn of calmQueue.splice(0)) fn()
}

// ---------- 하늘의 구름 만지기: 밀기, 내 구름 고르기 ----------

let picked: Cloud | null = null
let grab: { c: Cloud; id: number; x: number; t: number; moved: boolean } | null = null

function cloudAt(x: number, y: number) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]
    if (c.phase !== 'drift' || !c.sprite) continue
    const s = c.sprite
    const l = c.x - s.ox * c.depth
    const t = c.y - s.oy * c.depth
    // 스프라이트 가장자리의 빈 곳은 빼고
    const mx = s.w * c.depth * 0.12
    const my = s.h * c.depth * 0.12
    if (x >= l + mx && x <= l + s.w * c.depth - mx && y >= t + my && y <= t + s.h * c.depth - my) return c
  }
  return null
}

sky.addEventListener('pointerdown', (e) => {
  const c = cloudAt(e.clientX, e.clientY)
  if (!c) {
    closeSlip()
    return
  }
  if (c !== picked) closeSlip()
  sky.setPointerCapture(e.pointerId)
  grab = { c, id: e.pointerId, x: e.clientX, t: e.timeStamp, moved: false }
})
sky.addEventListener('pointermove', (e) => {
  if (!grab || e.pointerId !== grab.id) return
  const dx = e.clientX - grab.x
  if (!grab.moved && Math.abs(dx) < 8) return
  // 쓸어 넘긴 빠르기만큼 밀려났다가 다시 바람을 탄다
  const dt = Math.max(16, e.timeStamp - grab.t) / 1000
  grab.c.vx = Math.max(-260, Math.min(260, (grab.moved ? grab.c.vx * 0.5 : 0) + (dx / dt) * 0.5))
  grab.moved = true
  grab.x = e.clientX
  grab.t = e.timeStamp
  if (grab.c === picked) closeSlip()
})
const endGrab = (e: PointerEvent) => {
  if (!grab || e.pointerId !== grab.id) return
  const { c, moved } = grab
  grab = null
  if (!moved && e.type === 'pointerup' && c.user) pick(c)
}
sky.addEventListener('pointerup', endGrab)
sky.addEventListener('pointercancel', endGrab)

// 키보드: 하늘에 초점을 두고 Enter 를 누르면 내 구름을 차례로 고른다
sky.tabIndex = 0
sky.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const mine = clouds.filter((c) => c.user && c.phase === 'drift')
  if (mine.length === 0) return
  e.preventDefault()
  pick(mine[(mine.indexOf(picked!) + 1) % mine.length], true)
})

const slipShare = $<HTMLButtonElement>('#slip-share')
const slipDrop = $<HTMLButtonElement>('#slip-drop')

function pick(c: Cloud, focus = false) {
  picked = c
  c.vx = 0
  slipShare.hidden = !canShareFiles()
  slipDrop.textContent = '내리기'
  slipDrop.classList.remove('sure')
  slip.hidden = false
  const s = c.sprite!
  const w = slip.offsetWidth
  const h = slip.offsetHeight
  // 구름 아래에 달되, 스케치북을 덮게 되면 구름 위에 단다
  const below = c.y + (s.h - s.oy) * c.depth * 0.8 + 6
  const floor = SIDE_BOOK.matches ? H - 8 : book.getBoundingClientRect().top - 4
  const top = below + h > floor ? c.y - s.oy * c.depth * 0.8 - h - 6 : below
  slip.style.left = `${Math.max(8, Math.min(W - w - 8, c.x - w / 2))}px`
  slip.style.top = `${Math.max(8, top)}px`
  sr.textContent = '내 구름을 골랐어요. 저장하거나 내릴 수 있어요'
  if (focus) $<HTMLButtonElement>('#slip-save').focus()
}

function closeSlip() {
  if (slip.hidden) return
  const inside = slip.contains(document.activeElement)
  slip.hidden = true
  picked = null
  if (inside) sky.focus() // 키보드로 골랐으면 하늘로 돌아가 다음 구름을 고를 수 있게
}

async function exportPicked(how: 'save' | 'share') {
  const c = picked
  if (!c) return
  const blob = await cloudPng(c.puffs, tone)
  closeSlip()
  if (!blob) {
    showToast('그림으로 만들지 못했어요')
    return
  }
  if (how === 'save') {
    download(blob)
    showToast('구름을 그림으로 저장했어요')
  } else if ((await shareOrDownload(blob)) === 'saved') showToast('보내기가 안 돼서 그림으로 저장했어요')
}
$('#slip-save').addEventListener('click', () => void exportPicked('save'))
slipShare.addEventListener('click', () => void exportPicked('share'))
slipDrop.addEventListener('click', () => {
  // 그린 구름이 사라지는 일이라 한 번 더 누르게 한다
  if (!slipDrop.classList.contains('sure')) {
    slipDrop.classList.add('sure')
    slipDrop.textContent = '정말 내리기'
    return
  }
  if (picked) {
    picked.phase = 'fade'
    picked.t = 0
    save()
    sr.textContent = '구름을 내렸어요'
  }
  closeSlip()
})

// ---------- 스케치북 위의 도구 ----------

const desk = setupDesk(pad, (text) => { sr.textContent = text })
pad.onChange = (has, canUndo) => {
  sendBtn.disabled = !has
  undoBtn.disabled = !canUndo
  if (!holdHint || has) hint.classList.toggle('off', has)
  if (has) desk.forgetTurned()
}
sendBtn.addEventListener('click', sendDrawing)

// Esc: 열려 있는 것을 하나 닫는다(쪽지는 '괜찮아요'와 같다)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (desk.closeAbout()) return
  if (!slip.hidden) closeSlip()
  else if (note.open) note.decline()
})

// ---------- 시작 ----------

// 공유는 기본으로 꺼 두고, 첫 전송 뒤 한 번 물어본다(2026-11-09 결정)
setSharing(store.get(KEYS.share) === '1')
shareRow.hidden = !asked() && !shareBox.checked
setNick(store.get(KEYS.nick) ?? '')
if (matchMedia('(pointer: coarse)').matches) $('#hint-words').textContent = '손가락으로 아무거나 그려 보세요'
if (store.get(KEYS.clouds) || asked()) hint.classList.add('again')

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
    closeSlip()
    note.place()
  }, 120)
})

// 화면 키보드 높이: 이름을 적는 동안 쪽지를 키보드 바로 위로 옮긴다. 브라우저 화면은 줄지 않고 보이는 영역만 줄어드는 경우가 많다
const vv = window.visualViewport
if (vv) {
  const onViewport = () => {
    if (vv.scale > 1.01) return // 손가락으로 확대한 동안은 키보드가 아니라 확대 때문에 줄어든 것
    const h = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    kb = h < 60 ? 0 : h
    note.place()
  }
  vv.addEventListener('resize', onViewport)
  vv.addEventListener('scroll', onViewport)
}

resize()
for (let i = 0; i < 6; i++) addAmbient(i, false)
for (let i = 6; i < 8; i++) addAmbient(i, true)
load()
void startShared().then(tellApproved)
// 열어 둔 채 시간이 흐르면 하늘빛도 따라간다
window.setInterval(() => { if (!document.hidden) tone = paintBackdrop(bgCanvas, W, H, dpr) }, 5 * 60_000)
requestAnimationFrame(frame)
