import './admin.css'
import { bake, puffsFromStrokes } from './cloud'
import { toStrokes } from './shared'

type Status = 'pending' | 'approved' | 'rejected' | 'hidden'
type Item = { id: string; seed: number; pts: number[][]; nick: string; status: Status; created_at: number }

const grid = document.querySelector<HTMLElement>('#grid')!
const empty = document.querySelector<HTMLElement>('#empty')!
const more = document.querySelector<HTMLButtonElement>('#more')!
const statsEl = document.querySelector<HTMLElement>('#stats')!
const allBox = document.querySelector<HTMLInputElement>('#all')!
const pickedEl = document.querySelector<HTMLElement>('#picked')!
const bulkEl = document.querySelector<HTMLElement>('#bulk-actions')!
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-status]')]

/** 상태마다 할 수 있는 일: [라벨, 바꿀 상태, 스타일] */
const ACTIONS: Record<Status, [string, Status, string][]> = {
  pending: [['승인', 'approved', 'ok'], ['거절', 'rejected', 'no']],
  approved: [['내리기', 'hidden', 'no']],
  rejected: [['승인', 'approved', 'ok'], ['대기로', 'pending', '']],
  hidden: [['다시 올리기', 'approved', 'ok']],
}

let status: Status = 'pending'
let items: Item[] = []
const picked = new Set<string>()
let cursor: number | null = null

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}

async function loadStats() {
  try {
    const s = await api<Record<string, number>>('/admin/api/stats')
    const rows: [string, number][] = [
      ['오늘 제출', s.today],
      ['대기', s.pending],
      ['승인', s.approved],
      ['거절', s.rejected],
    ]
    statsEl.replaceChildren(
      ...rows.map(([k, v]) => {
        const d = document.createElement('div')
        const dt = document.createElement('dt')
        dt.textContent = k
        const dd = document.createElement('dd')
        dd.textContent = String(v)
        d.append(dt, dd)
        return d
      }),
    )
  } catch {
    statsEl.textContent = '통계를 불러오지 못했어요'
  }
}

function preview(it: Item) {
  const cv = document.createElement('canvas')
  cv.width = 440
  cv.height = 330
  const g = cv.getContext('2d')!
  const strokes = toStrokes(it.pts)
  let maxX = 1
  let maxY = 1
  for (const s of strokes) for (const p of s) {
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  // 하늘에서와 같은 모양으로 굽고, 칸에 맞게 줄인다
  const puffs = puffsFromStrokes(strokes, it.seed, 1.15 * Math.min(1, 260 / Math.max(maxX, maxY)))
  if (puffs.length) {
    const sp = bake(puffs, 1)
    const k = Math.min(1, (cv.width - 40) / sp.w, (cv.height - 40) / sp.h)
    g.drawImage(sp.canvas, (cv.width - sp.w * k) / 2, (cv.height - sp.h * k) / 2, sp.w * k, sp.h * k)
  }
  // 원래 선도 옅게 겹쳐서, 구름으로 뭉개져 안 보이는 글씨·그림을 확인할 수 있게
  const k = Math.min((cv.width - 60) / maxX, (cv.height - 60) / maxY)
  g.strokeStyle = 'rgba(30, 60, 100, 0.55)'
  g.lineWidth = 2
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const ox = (cv.width - maxX * k) / 2
  const oy = (cv.height - maxY * k) / 2
  for (const s of strokes) {
    g.beginPath()
    s.forEach((p, i) => (i ? g.lineTo(ox + p.x * k, oy + p.y * k) : g.moveTo(ox + p.x * k, oy + p.y * k)))
    g.stroke()
  }
  return cv
}

const fmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function card(it: Item) {
  const el = document.createElement('article')
  el.className = 'card'
  el.dataset.id = it.id
  const cv = preview(it)
  cv.setAttribute('role', 'checkbox')
  cv.setAttribute('aria-label', `${it.nick || '익명'} 구름 선택`)
  cv.tabIndex = 0
  const toggle = () => {
    if (picked.has(it.id)) picked.delete(it.id)
    else picked.add(it.id)
    sync()
  }
  cv.addEventListener('click', toggle)
  cv.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      toggle()
    }
  })

  const meta = document.createElement('div')
  meta.className = 'meta'
  const nick = document.createElement('span')
  nick.className = it.nick ? 'nick' : 'nick anon'
  nick.textContent = it.nick || '익명'
  const time = document.createElement('time')
  time.dateTime = new Date(it.created_at).toISOString()
  time.textContent = fmt.format(it.created_at)
  meta.append(nick, time)

  const acts = document.createElement('div')
  acts.className = 'acts'
  for (const [label, to, cls] of ACTIONS[it.status]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `act ${cls}`
    b.textContent = label
    b.addEventListener('click', () => review([it.id], to))
    acts.append(b)
  }
  el.append(cv, meta, acts)
  return el
}

function sync() {
  for (const el of grid.querySelectorAll<HTMLElement>('.card')) {
    const on = picked.has(el.dataset.id!)
    el.classList.toggle('sel', on)
    el.querySelector('canvas')!.setAttribute('aria-checked', String(on))
  }
  pickedEl.textContent = `${picked.size}개 선택`
  allBox.checked = items.length > 0 && picked.size === items.length
  for (const b of bulkEl.querySelectorAll('button')) b.disabled = picked.size === 0
}

function renderBulk() {
  bulkEl.replaceChildren(
    ...ACTIONS[status].map(([label, to, cls]) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `act ${cls}`
      b.textContent = `선택 ${label}`
      b.addEventListener('click', () => review([...picked], to))
      return b
    }),
  )
}

async function load(reset: boolean) {
  if (reset) {
    items = []
    picked.clear()
    cursor = null
    grid.replaceChildren()
  }
  const q = new URLSearchParams({ status })
  if (cursor !== null) q.set(status === 'pending' ? 'after' : 'before', String(cursor))
  try {
    const { items: got } = await api<{ items: Item[] }>(`/admin/api/list?${q}`)
    items.push(...got)
    grid.append(...got.map(card))
    if (got.length) cursor = got[got.length - 1].created_at
    more.hidden = got.length < 60
  } catch (e) {
    more.hidden = true
    empty.textContent = (e as Error).message === '403' ? '권한이 없어요. 다시 로그인해 주세요.' : '목록을 불러오지 못했어요.'
    empty.hidden = false
    return
  }
  empty.textContent = '여기는 비어 있어요.'
  empty.hidden = items.length > 0
  sync()
}

async function review(ids: string[], to: Status) {
  if (ids.length === 0) return
  for (const b of document.querySelectorAll<HTMLButtonElement>('button.act')) b.disabled = true
  try {
    await api('/admin/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, status: to }),
    })
    // 처리한 카드는 목록에서 뺀다
    const done = new Set(ids)
    items = items.filter((it) => !done.has(it.id))
    for (const id of ids) {
      picked.delete(id)
      grid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
    }
    empty.hidden = items.length > 0
  } catch {
    alert('처리하지 못했어요. 잠시 뒤 다시 해 주세요.')
  } finally {
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.act')) b.disabled = false
    sync()
    void loadStats()
  }
}

for (const t of tabs) {
  t.addEventListener('click', () => {
    status = t.dataset.status as Status
    for (const o of tabs) o.setAttribute('aria-selected', String(o === t))
    renderBulk()
    void load(true)
  })
}
allBox.addEventListener('change', () => {
  picked.clear()
  if (allBox.checked) for (const it of items) picked.add(it.id)
  sync()
})
more.addEventListener('click', () => void load(false))

renderBulk()
void loadStats()
void load(true)
