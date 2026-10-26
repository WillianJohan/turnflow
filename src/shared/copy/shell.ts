// Textos da tela (abas, lateral, Início, paleta, visão da task), em inglês. O E6.9 traduz.

export const SHELL_COPY = {
  task: {
    gone: (key: string): string => `${key} no longer exists.`
  },
  taskView: {
    record: 'Record',
    terminal: 'Terminal',
    endSession: 'End session',
    closeTask: 'Close task',
    confirmTitle: 'Are you sure?',
    cancel: 'Cancel',
    save: 'Save',
    workdir: 'Working folder',
    block: 'Block',
    keepOrAdopt: 'Keep the current flow, or adopt the project flow?',
    keep: 'Keep',
    adopt: 'Adopt',
    noProject: 'No project',
    remap: (from: string, to: string): string =>
      `The project flow has no ${from} stage. The task goes to ${to}.`,
    apply: 'Move',
    other: 'Other',
    reopen: 'Reopen',
    exited: (code: number): string => `The process exited (code ${code}).`,
    undo: {
      stage: (stage: string, jira: boolean): string =>
        jira ? `Moved to ${stage} · goes to Jira` : `Moved to ${stage}`,
      moved: 'Task moved',
      blocked: 'Task blocked',
      unblocked: 'Task unblocked',
      closed: 'Task closed'
    }
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
  project: {
    title: 'New project',
    name: 'Project name',
    required: 'Type a name for the project',
    create: 'Create project',
    creating: 'Creating…',
    cancel: 'Cancel',
    created: (name: string): string => `Project ${name} created`
  },
  timeline: {
    all: 'All',
    records: 'Records',
    sessions: 'Sessions',
    filter: 'Show',
    record: 'Record',
    session: 'Session',
    resume: 'Resume',
    newSession: 'New session',
    running: 'A session is running.',
    toTerminal: 'Go to terminal'
  },
  undo: 'Undo',
  syncOff: 'Sync is not connected yet.'
} as const
