import type { TaskState } from '../../shared/types'

export type HookInfo = { event: string; message?: string }

const GAP = 15_000

// Aviso de pendência: o claude passou a esperar você e você não está vendo aquela aba.
export const shouldNotify = (o: {
  state: TaskState
  enabled: boolean
  watching: boolean // janela em foco e a aba visível
  lastAt: number
  now: number
}): boolean => o.enabled && o.state === 'waiting' && !o.watching && o.now - o.lastAt >= GAP

export function notifyText(label: string, info: HookInfo): { title: string; body: string } | null {
  if (info.event === 'Notification')
    return { title: `${label} · Pediu permissão`, body: info.message || 'Esperando você' }
  if (info.event === 'Stop') return { title: `${label} · Terminou`, body: 'Esperando você' }
  return null
}
