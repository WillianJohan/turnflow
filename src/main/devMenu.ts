import { Menu, dialog } from 'electron'
import type { QueryStat } from '../core/db/timing'

const TOP = 30
const fmt = (n: number): string => `${n.toFixed(1)}ms`

/** Menu só de desenvolvimento: mostra a duração acumulada das queries. */
export function installDevMenu(getStats: () => QueryStat[]): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'editMenu' },
      {
        label: 'Dev',
        submenu: [
          {
            label: 'Duração das queries',
            click: () => {
              const lines = getStats()
                .slice(0, TOP)
                .map(
                  (s) =>
                    `${s.name} · ${s.count} · ${fmt(s.totalMs)} · ${fmt(s.maxMs)} · ` +
                    Object.entries(s.buckets)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(' ')
                )
              void dialog.showMessageBox({
                type: 'info',
                message: 'Duração das queries',
                detail: lines.join('\n') || 'Nenhuma query registrada.'
              })
            }
          }
        ]
      }
    ])
  )
}
