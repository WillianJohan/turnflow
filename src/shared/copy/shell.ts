// Textos da tela (abas, lateral, Início, paleta, visão da task), em inglês. O E6.9 traduz.

export const SHELL_COPY = {
  task: {
    gone: (key: string): string => `${key} no longer exists.`
  },
  newMenu: {
    label: 'New',
    task: 'Task',
    project: 'Project',
    claude: 'Claude without a task',
    terminal: 'Terminal'
  },
  palette: {
    label: 'Command palette',
    results: 'Results',
    placeholder: 'Search, create, or > command',
    create: 'Create',
    creating: 'Creating…',
    noProject: 'No project',
    done: 'Done',
    empty: 'Nothing matches',
    createFailed: 'The task was not created'
  },
  syncOff: 'Sync is not connected yet.'
} as const
