import { BrowserWindow } from 'electron'
import { createChangeBus } from './changeBus'
import type { Events } from '../shared/ipc/events'

// Instância única do app, fora do index.ts: o banco (E2) importa daqui sem ciclo com o entry.
const broadcast = (...a: Events['domain.changed']): void =>
  BrowserWindow.getAllWindows().forEach(
    (w) => !w.isDestroyed() && w.webContents.send('domain.changed', ...a)
  )

export const changeBus = createChangeBus({ emit: broadcast })
