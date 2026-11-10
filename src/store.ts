/** 이 기기에 남기는 것들. 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 조용히 넘어간다. */

export const KEYS = {
  clouds: 'sky-doodle:v1',
  nick: 'sky-doodle:nick',
  share: 'sky-doodle:share',
  asked: 'sky-doodle:asked', // 첫 전송 뒤 공유를 물어봤는지
  sent: 'sky-doodle:sent', // 공유로 보낸 구름 id(승인됐는지 다음에 알려 주려고)
} as const

// 저장소가 막혀 있어도 이번 방문 동안은 값이 남도록 메모리에 같이 둔다(안 그러면 적은 이름이 빠지고 쪽지가 매번 다시 뜬다)
const memory = new Map<string, string>()

export const store = {
  get(key: string) {
    const kept = memory.get(key)
    if (kept !== undefined) return kept
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    memory.set(key, value)
    try {
      localStorage.setItem(key, value)
    } catch {
      /* 저장 공간이 없거나 막혀 있으면 저장 안 함 */
    }
  },
}

export function sentIds(): string[] {
  try {
    const v: unknown = JSON.parse(store.get(KEYS.sent) || '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}
