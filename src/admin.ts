import './admin.css'
import { bake } from './cloud.ts'
import { layoutCloud, sharedScale, toStrokes } from './geom.ts'

type Status = 'pending' | 'approved' | 'rejected' | 'hidden'
type Item = {
  id: string; seed: number; pts: number[][]; nick: string; status: Status; created_at: number
  reviewed_by?: string | null
  sender?: string // 접속 해시 앞 8자. 이틀 뒤에는 비어 있다
}

const grid = document.querySelector<HTMLElement>('#grid')!
const empty = document.querySelector<HTMLElement>('#empty')!
const more = document.querySelector<HTMLButtonElement>('#more')!
const statsEl = document.querySelector<HTMLElement>('#stats')!
const allBox = document.querySelector<HTMLInputElement>('#all')!
const pickedEl = document.querySelector<HTMLElement>('#picked')!
const bulkEl = document.querySelector<HTMLElement>('#bulk-actions')!
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-status]')]
const notice = document.querySelector<HTMLElement>('#notice')!

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
      ['내림', s.hidden],
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
  // 하늘에서와 같은 모양으로 굽고, 칸에 맞게 줄인다
  const scale = sharedScale(strokes)
  const { puffs, cx, cy } = layoutCloud(strokes, it.seed, scale)
  if (puffs.length === 0) return cv
  const sp = bake(puffs, 1)
  const k = Math.min(1, (cv.width - 40) / sp.w, (cv.height - 40) / sp.h)
  // 구름 가운데(원래 선의 가운데)가 놓인 자리
  const ox = (cv.width - sp.w * k) / 2 + sp.ox * k
  const oy = (cv.height - sp.h * k) / 2 + sp.oy * k
  g.drawImage(sp.canvas, ox - sp.ox * k, oy - sp.oy * k, sp.w * k, sp.h * k)
  // 원래 선을 구름과 같은 배율·같은 자리에 옅게 겹친다: 구름으로 뭉개져 안 보이는 글씨·그림을 확인할 수 있게
  g.strokeStyle = 'rgba(30, 60, 100, 0.55)'
  g.lineWidth = 2
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const at = (p: { x: number; y: number }) => [ox + (p.x - cx) * scale * k, oy + (p.y - cy) * scale * k] as const
  for (const s of strokes) {
    g.beginPath()
    s.pts.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))))
    g.stroke()
  }
  return cv
}

const fmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function actButton(label: string, cls: string, run: () => void) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `act ${cls}`
  b.textContent = label
  b.addEventListener('click', run)
  return b
}

function card(it: Item) {
  const el = document.createElement('article')
  el.className = 'card'
  el.dataset.id = it.id
  el.tabIndex = -1
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
  for (const [label, to, cls] of ACTIONS[it.status]) acts.append(actButton(label, cls, () => review({ ids: [it.id], status: to })))
  el.append(cv, meta, acts)

  // 그림은 괜찮고 이름만 문제일 때, 한 접속이 대기열을 채웠을 때
  const more = document.createElement('div')
  more.className = 'acts sub'
  if (it.status === 'pending' && it.nick) {
    more.append(actButton('이름 지우고 승인', '', () => review({ ids: [it.id], status: 'approved', clearNick: true })))
  }
  const mates = it.sender ? items.filter((o) => o.sender === it.sender).length : 0
  if (it.status === 'pending' && mates > 1) {
    more.append(actButton(`같은 접속의 대기 전부 거절 (보이는 것 ${mates}개)`, 'no', () => review({ senderOf: it.id })))
  }
  if (more.childElementCount) el.append(more)
  if (it.reviewed_by) {
    const by = document.createElement('p')
    by.className = 'by'
    by.textContent = it.reviewed_by === 'auto' ? '오래 대기해 자동으로 거절됨' : `확인: ${it.reviewed_by}`
    el.append(by)
  }
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
    ...ACTIONS[status].map(([label, to, cls]) => actButton(`선택 ${label}`, cls, () => review({ ids: [...picked], status: to }))),
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

type Review = { ids: string[]; status: Status; clearNick?: boolean } | { senderOf: string }

let busy = false // 처리 중에는 버튼도 단축키도 받지 않는다

async function review(job: Review) {
  if (busy || ('ids' in job && job.ids.length === 0)) return
  busy = true
  for (const b of document.querySelectorAll<HTMLButtonElement>('button.act')) b.disabled = true
  notice.hidden = true
  try {
    // 서버는 한 번에 100개까지 받는다
    const jobs = 'ids' in job ? Array.from({ length: Math.ceil(job.ids.length / 100) }, (_, i) => ({ ...job, ids: job.ids.slice(i * 100, i * 100 + 100) })) : [job]
    for (const part of jobs) {
      await api('/admin/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(part),
      })
    }
    if ('senderOf' in job) {
      // 화면에 없는 것까지 바뀌었을 수 있으므로 목록을 다시 받는다
      await load(true)
    } else {
      // 처리한 카드는 목록에서 빼고, 다음 카드로 넘어간다
      const next = focused()?.nextElementSibling
      const done = new Set(job.ids)
      items = items.filter((it) => !done.has(it.id))
      for (const id of job.ids) {
        picked.delete(id)
        grid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove()
      }
      empty.hidden = items.length > 0
      if (next instanceof HTMLElement && next.isConnected) next.focus()
    }
  } catch {
    notice.textContent = '처리하지 못했어요. 잠시 뒤 다시 해 주세요.'
    notice.hidden = false
  } finally {
    busy = false
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.act')) b.disabled = false
    sync()
    void loadStats() // 여러 개를 한꺼번에 처리해도 한 번만 부른다
  }
}

function selectTab(t: HTMLButtonElement) {
  status = t.dataset.status as Status
  for (const o of tabs) {
    o.setAttribute('aria-selected', String(o === t))
    o.tabIndex = o === t ? 0 : -1
  }
  grid.setAttribute('aria-labelledby', t.id)
  renderBulk()
  void load(true)
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t))
  t.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = tabs[(i + step + tabs.length) % tabs.length]
    next.focus()
    selectTab(next)
  })
})
allBox.addEventListener('change', () => {
  picked.clear()
  if (allBox.checked) for (const it of items) picked.add(it.id)
  sync()
})
more.addEventListener('click', () => void load(false))

// 단축키: J/K 로 카드 사이를 옮기고, A 승인, R 거절(승인됨 탭에서는 내리기)
function focused() {
  return document.activeElement?.closest<HTMLElement>('.card') ?? null
}
window.addEventListener('keydown', (e) => {
  // 키를 누르고 있어 반복 입력이 들어오면 보지 않은 카드까지 처리된다
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).matches('input, textarea')) return
  const key = e.key.toLowerCase()
  const cur = focused()
  if (key === 'j' || key === 'k') {
    const cards = [...grid.querySelectorAll<HTMLElement>('.card')]
    const i = cur ? cards.indexOf(cur) + (key === 'j' ? 1 : -1) : 0
    cards[Math.max(0, Math.min(cards.length - 1, i))]?.focus()
    e.preventDefault()
    return
  }
  if (busy || !cur || (key !== 'a' && key !== 'r')) return
  const want = key === 'a' ? 'ok' : 'no'
  const act = ACTIONS[status].find(([, , cls]) => cls === want)
  if (!act) return
  e.preventDefault()
  void review({ ids: [cur.dataset.id!], status: act[1] })
})

selectTab(tabs[0])
void loadStats()
