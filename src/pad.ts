import { BASE_W, nearStroke, PointerGate, type Pt, type Stroke } from './geom.ts'

const INK = '#4b5a6c'
const ERASE_REACH = 9

/** 되돌릴 수 있는 한 동작: 획 하나를 그었거나, 지우개로 몇 획을 지웠거나 */
type Step = { add: Stroke } | { erased: { at: number; stroke: Stroke }[] }

/** 스케치북 캔버스: 포인터로 선을 긋고 선 데이터를 모은다. */
export class Pad {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private strokes: Stroke[] = []
  private steps: Step[] = []
  private current: Stroke | null = null
  private rubbing: { at: number; stroke: Stroke }[] | null = null
  private gate = new PointerGate()
  private dpr = 1
  private width: number = BASE_W
  private erasing = false
  onChange: (hasInk: boolean, canUndo: boolean) => void = () => {}
  /** 종이가 기운 각도(라디안). 스케치북 쪽에서 알려 준다. */
  tilt: () => number = () => 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    new ResizeObserver(() => this.resize()).observe(canvas)
    this.resize()

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      // 손가락 두 개·손바닥: 먼저 닿은 포인터만 그린다. 펜이 닿으면 손이 긋던 선은 버린다
      const turn = this.gate.down(e.pointerId, e.pointerType)
      if (turn === 'ignore') return
      if (turn === 'takeover') {
        this.dropCurrent()
        // 손이 지우던 중이었으면 거기까지를 한 번의 지우개질로 남긴다
        if (this.rubbing?.length) this.steps.push({ erased: this.rubbing })
        this.rubbing = null
      }
      canvas.setPointerCapture(e.pointerId)
      const p = this.local(e)
      if (this.erasing) {
        this.rubbing = []
        this.rub(p)
        return
      }
      this.begin(p)
      this.emit()
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this.gate.owns(e.pointerId)) return
      const evs = e.getCoalescedEvents?.() ?? [e]
      // 종이가 기울어 있어 화면 좌표의 테두리가 아니라 캔버스 자체 크기로 안팎을 가른다
      const width = this.canvas.offsetWidth
      const height = this.canvas.offsetHeight
      for (const ev of evs.length ? evs : [e]) {
        const p = this.local(ev)
        if (this.rubbing) {
          this.rub(p)
          continue
        }
        const inside = p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height
        if (!inside) {
          // 종이 밖으로 나가면 펜을 뗀다: 가장자리까지만 긋고 선을 끝낸다
          if (this.current) {
            this.extend({ x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) })
            this.finish()
          }
          continue
        }
        if (!this.current) {
          // 누른 채 다시 들어오면 새 선
          this.begin(p)
          continue
        }
        const last = this.current.pts[this.current.pts.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) this.extend(p)
      }
    })
    const end = (e: PointerEvent) => {
      if (!this.gate.up(e.pointerId)) return
      if (this.rubbing) {
        if (this.rubbing.length) this.steps.push({ erased: this.rubbing })
        this.rubbing = null
        this.emit()
        return
      }
      this.finish()
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    // 떼는 신호를 못 받고 캡처만 풀린 경우에도 끝낸다(안 그러면 다음 터치가 계속 무시된다)
    canvas.addEventListener('lostpointercapture', end)
  }

  get hasInk() {
    return this.strokes.length > 0
  }

  /** 캔버스 안 좌표(CSS px) 그대로의 선들. */
  getStrokes(): Stroke[] {
    return this.strokes.map((s) => ({ pts: s.pts.slice(), w: s.w }))
  }

  /** 연필 굵기를 고른다(지우개는 내려놓는다) */
  usePencil(width: number) {
    this.width = width
    this.erasing = false
    this.canvas.classList.remove('erasing')
  }

  useEraser() {
    this.erasing = true
    this.canvas.classList.add('erasing')
  }

  /** 마지막 동작(획 하나, 또는 지우개질 한 번)을 되돌린다 */
  undo() {
    if (this.gate.active) return
    const step = this.steps.pop()
    if (!step) return
    if ('add' in step) {
      const i = this.strokes.lastIndexOf(step.add)
      if (i >= 0) this.strokes.splice(i, 1)
    } else {
      // 지운 순서의 반대로 제자리에 다시 넣는다
      for (const { at, stroke } of step.erased.slice().reverse()) this.strokes.splice(Math.min(at, this.strokes.length), 0, stroke)
    }
    this.redraw()
    this.emit()
  }

  /** clear() 직전 선들로 되돌린다(새 종이 되돌리기) */
  restore(strokes: Stroke[]) {
    this.strokes = strokes.map((s) => ({ pts: s.pts.slice(), w: s.w }))
    this.steps = this.strokes.map((s) => ({ add: s }))
    this.redraw()
    this.emit()
  }

  clear() {
    this.strokes = []
    this.steps = []
    this.current = null
    this.rubbing = null
    this.gate.reset()
    this.redraw()
    this.emit()
  }

  private emit() {
    this.onChange(this.strokes.length > 0, this.steps.length > 0)
  }

  private begin(p: Pt) {
    this.current = { pts: [p], w: this.width }
    this.strokes.push(this.current)
    this.steps.push({ add: this.current })
    this.style(this.current.w)
    this.ctx.beginPath()
    this.ctx.arc(p.x, p.y, this.current.w / 2, 0, Math.PI * 2)
    this.ctx.fill()
  }

  /** 그리는 동안에는 새로 늘어난 구간만 덧그린다(전체 다시 그리기는 끝났을 때 한 번) */
  private extend(p: Pt) {
    const s = this.current!
    const last = s.pts[s.pts.length - 1]
    s.pts.push(p)
    this.style(s.w)
    this.ctx.beginPath()
    this.ctx.moveTo(last.x, last.y)
    this.ctx.lineTo(p.x, p.y)
    this.ctx.stroke()
  }

  private finish() {
    if (!this.current) return
    this.current = null
    this.redraw() // 덧그린 직선 구간을 부드러운 곡선으로 정리
  }

  private dropCurrent() {
    if (!this.current) return
    const s = this.current
    this.current = null
    this.strokes = this.strokes.filter((x) => x !== s)
    this.steps = this.steps.filter((x) => !('add' in x) || x.add !== s)
    this.redraw()
    this.emit()
  }

  /** 지우개: 닿은 획을 통째로 지운다 */
  private rub(p: Pt) {
    let hit = false
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (!nearStroke(this.strokes[i], p, ERASE_REACH)) continue
      this.rubbing!.push({ at: i, stroke: this.strokes[i] })
      this.strokes.splice(i, 1)
      hit = true
    }
    if (hit) {
      this.redraw()
      this.emit()
    }
  }

  /** 포인터 위치를 종이 좌표로. 스케치북이 기울어 있으므로 캔버스 가운데를 축으로 되돌려 계산한다. */
  private local(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect()
    const a = -this.tilt()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a) + this.canvas.offsetWidth / 2,
      y: dx * Math.sin(a) + dy * Math.cos(a) + this.canvas.offsetHeight / 2,
    }
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(this.canvas.offsetWidth * this.dpr))
    this.canvas.height = Math.max(1, Math.round(this.canvas.offsetHeight * this.dpr))
    this.redraw()
  }

  private style(w: number) {
    const { ctx } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    ctx.lineWidth = w
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  private redraw() {
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    for (const { pts: s, w } of this.strokes) {
      this.style(w)
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0].x, s[0].y, w / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      ctx.moveTo(s[0].x, s[0].y)
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i].x + s[i + 1].x) / 2
        const my = (s[i].y + s[i + 1].y) / 2
        ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my)
      }
      const l = s[s.length - 1]
      ctx.lineTo(l.x, l.y)
      ctx.stroke()
    }
  }
}
