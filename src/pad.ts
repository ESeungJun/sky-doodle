export type Pt = { x: number; y: number }
export type Stroke = Pt[]

const INK = '#4b5a6c'
const WIDTH = 5

/** 스케치북 캔버스: 포인터로 선을 긋고 선 데이터를 모은다. */
export class Pad {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private strokes: Stroke[] = []
  private current: Stroke | null = null
  private pressing = false
  private dpr = 1
  onChange: (hasInk: boolean) => void = () => {}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    new ResizeObserver(() => this.resize()).observe(canvas)
    this.resize()

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      canvas.setPointerCapture(e.pointerId)
      this.pressing = true
      this.current = [this.local(e)]
      this.strokes.push(this.current)
      this.redraw()
      this.onChange(true)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pressing) return
      const evs = e.getCoalescedEvents?.() ?? [e]
      const { width, height } = this.canvas.getBoundingClientRect()
      for (const ev of evs) {
        const p = this.local(ev)
        const inside = p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height
        if (!inside) {
          // 종이 밖으로 나가면 펜을 뗀다: 가장자리까지만 긋고 선을 끝낸다
          if (this.current) {
            this.current.push({ x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) })
            this.current = null
          }
          continue
        }
        if (!this.current) {
          // 누른 채 다시 들어오면 새 선
          this.current = [p]
          this.strokes.push(this.current)
          continue
        }
        const last = this.current[this.current.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) this.current.push(p)
      }
      this.redraw()
    })
    const end = () => {
      this.current = null
      this.pressing = false
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
  }

  get hasInk() {
    return this.strokes.length > 0
  }

  /** 캔버스 안 좌표(CSS px) 그대로의 선들. */
  getStrokes(): Stroke[] {
    return this.strokes.map((s) => s.slice())
  }

  clear() {
    this.strokes = []
    this.current = null
    this.pressing = false
    this.redraw()
    this.onChange(false)
  }

  private local(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr))
    this.redraw()
  }

  private redraw() {
    const { ctx } = this
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    ctx.lineWidth = WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of this.strokes) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0].x, s[0].y, WIDTH / 2, 0, Math.PI * 2)
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
