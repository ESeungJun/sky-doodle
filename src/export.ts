/** 구름 한 개를 하늘 배경과 함께 정사각 PNG 로 굽고, 기기 공유 창이나 내려받기로 넘긴다. */
import { bake } from './cloud.ts'
import { bounds, fitScale, type Puff } from './geom.ts'
import { SKY_STOPS, type SkyTone } from './skytone.ts'

const SIZE = 1080

export async function cloudPng(puffs: Puff[], tone: SkyTone): Promise<Blob | null> {
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const g = cv.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, SIZE)
  tone.stops.forEach((c, i) => grad.addColorStop(SKY_STOPS[i], c))
  g.fillStyle = grad
  g.fillRect(0, 0, SIZE, SIZE)
  const b = bounds(puffs)
  const k = fitScale(b.maxX - b.minX, b.maxY - b.minY, SIZE)
  // 화면에서보다 크게 나가므로 그 크기로 다시 굽는다(늘린 흐린 그림이 되지 않게)
  const sp = bake(puffs, Math.min(4, k))
  g.globalAlpha = 1 - tone.dusk * 0.4 // 화면에서처럼 밤에는 구름이 하늘빛에 잠긴다
  g.drawImage(sp.canvas, (SIZE - sp.w * k) / 2, (SIZE - sp.h * k) / 2, sp.w * k, sp.h * k)
  return new Promise((done) => cv.toBlob(done, 'image/png'))
}

const NAME = 'sky-doodle-cloud.png'

/** 기기 공유 창으로 보낼 수 있는지(파일 공유를 지원하는 브라우저) */
export function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([], NAME, { type: 'image/png' })] })
  } catch {
    return false
  }
}

export function download(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = NAME
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 공유 창을 띄운다. 지원하지 않거나 실패하면 내려받는다. 사용자가 창을 닫은 것은 실패가 아니다. */
export async function shareOrDownload(blob: Blob): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], NAME, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '하늘 스케치북' })
      return 'shared'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled'
    }
  }
  download(blob)
  return 'saved'
}
