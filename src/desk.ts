/** 스케치북 위의 도구: 연필 세 자루와 지우개, 되돌리기, 새 종이(넘기기·되돌리기), 안내 종이. */
import type { Stroke } from './geom.ts'
import type { Pad } from './pad.ts'

export function setupDesk(pad: Pad, say: (text: string) => void) {
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

  // 연필꽂이: 라디오 묶음. 화살표 키로 옮긴다
  const tools = [...document.querySelectorAll<HTMLButtonElement>('#tools .tool')]
  function choose(btn: HTMLButtonElement) {
    for (const t of tools) {
      t.setAttribute('aria-checked', String(t === btn))
      t.tabIndex = t === btn ? 0 : -1
    }
    if (btn.dataset.eraser !== undefined) pad.useEraser()
    else pad.usePencil(Number(btn.dataset.w))
  }
  tools.forEach((btn, i) => {
    btn.addEventListener('click', () => choose(btn))
    btn.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = tools[(i + step + tools.length) % tools.length]
      choose(next)
      next.focus()
    })
  })
  choose(tools.find((t) => t.getAttribute('aria-checked') === 'true') ?? tools[0])

  $('#undo').addEventListener('click', () => pad.undo())

  // 새 종이: 그리던 종이가 위로 넘어가고, 4초 동안은 넘긴 종이의 귀퉁이를 잡아 되돌릴 수 있다
  const clearBtn = $<HTMLButtonElement>('#clear')
  const sheet = $('#sheet')
  const sheetInk = $<HTMLCanvasElement>('#sheet-ink')
  const corner = $<HTMLButtonElement>('#corner')
  let turned: Stroke[] | null = null
  let timer = 0

  function forgetTurned() {
    turned = null
    clearTimeout(timer)
    clearBtn.textContent = '새 종이'
    corner.hidden = true
  }
  function turnPage() {
    if (!pad.hasInk) return
    sheetInk.width = pad.canvas.width
    sheetInk.height = pad.canvas.height
    sheetInk.getContext('2d')!.drawImage(pad.canvas, 0, 0)
    const strokes = pad.getStrokes()
    pad.clear()
    turned = strokes
    sheet.classList.remove('back')
    sheet.hidden = false
    corner.hidden = false
    clearBtn.textContent = '되돌리기'
    say('새 종이로 넘겼어요. 되돌리기를 누르면 그리던 종이가 돌아와요')
    timer = window.setTimeout(forgetTurned, 4000)
  }
  function turnBack() {
    if (!turned) return
    const strokes = turned
    forgetTurned()
    sheet.classList.add('back')
    sheet.hidden = false
    pad.restore(strokes)
    say('그리던 종이를 되돌렸어요')
  }
  sheet.addEventListener('animationend', () => {
    sheet.hidden = true
  })
  clearBtn.addEventListener('click', () => (turned ? turnBack() : turnPage()))
  corner.addEventListener('click', turnBack)

  // 안내: 종이 한 장이 덮인다
  const about = $('#about')
  const help = $<HTMLButtonElement>('#help')
  const aboutOpen = () => help.getAttribute('aria-expanded') === 'true'
  function toggleAbout(open: boolean) {
    about.hidden = !open
    help.setAttribute('aria-expanded', String(open))
    if (open) $<HTMLButtonElement>('#about-close').focus()
    else help.focus()
  }
  help.addEventListener('click', () => toggleAbout(!aboutOpen()))
  $('#about-close').addEventListener('click', () => toggleAbout(false))

  return {
    /** 새로 그리기 시작했거나 그림을 보냈으면 넘긴 종이는 더 되돌릴 수 없다 */
    forgetTurned,
    /** 안내가 열려 있으면 닫고 true */
    closeAbout() {
      if (!aboutOpen()) return false
      toggleAbout(false)
      return true
    },
  }
}
