/**
 * 쪽지(#ask): 첫 전송 뒤 공유를 한 번 묻고, 구름에 달 이름을 적는다.
 * 종이를 덮지 않고 스케치북 가장자리에 붙으며, 그리기를 막지 않는다. Esc 는 '괜찮아요'.
 */

export type NoteHooks<J> = {
  nick(): string
  setNick(v: string): void
  /** 쪽지를 붙일 자리(left, bottom px)와 붙는 쪽. typing: 화면 키보드가 올라와 이름을 적는 중 */
  place(w: number, h: number, typing: boolean, job: J | null): { left: number; bottom: number; right?: boolean }
  keyboardUp(): boolean
  /** 띄우기로 했다 */
  accept(job: J): void
  /** 괜찮아요 */
  decline(): void
  /** 이름만 고치고 닫았다 */
  closed(): void
}

export function setupNote<J>(hooks: NoteHooks<J>) {
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
  const note = $<HTMLFormElement>('#ask')
  const q = $('#ask-q')
  const sub = $('#ask-sub')
  const field = $('#ask-field')
  const nick = $<HTMLInputElement>('#ask-nick')
  const yes = $<HTMLButtonElement>('#ask-yes')
  const no = $<HTMLButtonElement>('#ask-no')
  let job: J | null = null // 공유를 물어보는 중인 구름. 이름만 고칠 때는 null
  let step: 'ask' | 'name' = 'ask'

  function place() {
    if (note.hidden) return
    const typing = document.activeElement === nick && hooks.keyboardUp()
    note.classList.toggle('typing', typing)
    const at = hooks.place(note.offsetWidth, note.offsetHeight, typing, job)
    note.classList.toggle('right', !typing && !!at.right)
    note.style.left = `${at.left}px`
    note.style.bottom = `${at.bottom}px`
  }

  function show(next: 'ask' | 'name', forJob: J | null) {
    job = forJob
    step = next
    nick.value = hooks.nick()
    field.hidden = next === 'ask'
    if (job) {
      q.textContent = '이 구름, 다른 사람 하늘에도 띄울까요?'
      sub.textContent = next === 'ask' ? '확인을 거친 뒤에 떠요.' : '이름은 구름 아래 꼬리표에 보여요.'
      yes.textContent = '띄우기'
      no.textContent = '괜찮아요'
    } else {
      q.textContent = '구름에 달 이름'
      sub.textContent = '다른 사람 하늘에서 구름 아래 꼬리표에 보여요.'
      yes.textContent = '적어 두기'
      no.textContent = '닫기'
    }
    note.hidden = false
    place()
  }

  function close() {
    note.hidden = true
    note.classList.remove('typing')
    job = null
  }

  function decline() {
    const wasAsk = job !== null
    close()
    if (wasAsk) hooks.decline()
    else hooks.closed()
  }

  note.addEventListener('submit', (e) => {
    e.preventDefault()
    if (job !== null && step === 'ask') {
      // 띄우기로 했을 때에만 이름 칸을 연다
      show('name', job)
      nick.focus()
      return
    }
    hooks.setNick(nick.value)
    const done = job
    close()
    if (done !== null) hooks.accept(done)
    else hooks.closed()
  })
  no.addEventListener('click', decline)
  // 화면 키보드가 올라오고 내려갈 때 자리를 다시 잡는다
  nick.addEventListener('focus', () => setTimeout(place, 60))
  nick.addEventListener('blur', () => setTimeout(place, 60))

  return {
    get open() {
      return !note.hidden
    },
    /** 공유를 묻는다(초점은 가져가지 않는다: 그리던 손을 막지 않으려고) */
    ask(forJob: J) {
      if (note.hidden) show('ask', forJob)
    },
    editName() {
      if (!note.hidden) return
      show('name', null)
      nick.focus()
    },
    decline,
    place,
  }
}
