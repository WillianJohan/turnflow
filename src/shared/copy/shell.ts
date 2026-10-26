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
    switching: 'switching session',
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
  home: {
    older: 'Show older'
  },
  tabs: {
    settings: 'Settings',
    home: 'Home',
    claude: (n: string): string => `Claude ${n}`,
    terminal: (n: string): string => `Terminal ${n}`,
    newTab: 'New tab (Ctrl+Shift+T)',
    divider: 'Drag to resize · double-click to equalize',
    closeScratch: 'Close tab (ends the process)',
    closeTask: 'Close tab (the session keeps running)',
    closePanel: 'Close panel',
    empty: 'Empty panel. Use + above, Ctrl+Shift+K, or pick a task in the list.'
  },
  sidebar: {
    states: { waiting: 'waiting for you', working: 'working', idle: 'idle' },
    noSession: 'no session',
    kids: (open: boolean, n: number): string =>
      `${open ? 'Hide' : 'Show'} ${n} ${n === 1 ? 'subtask' : 'subtasks'}`,
    endSession: 'End session',
    toggle: (folded: boolean): string => `${folded ? 'Show' : 'Hide'} the list (Ctrl+Shift+B)`,
    resize: 'Drag to change the width. Double-click goes back to the default.',
    search: 'Search tasks (Ctrl+Shift+K)',
    searchLabel: 'Search key or title',
    filter: 'Filter by category',
    filterHead: 'Show categories',
    filterAll: 'All',
    removeFilter: (name: string): string => `Remove filter ${name}`,
    density: 'Density',
    densities: { compact: 'Compact', normal: 'Normal', wide: 'Wide' },
    noTasksIn: (root: string): string => `No tasks found in ${root}.`,
    noBrain: 'No brain folder yet: import one in Settings',
    open: 'Open',
    noneFiltered: 'No tasks in the filtered categories.',
    draft: (on: boolean): string => `Draft mode ${on ? 'on' : 'off'} (Ctrl+Shift+D)`,
    settings: 'Settings: theme and font',
    home: 'Home'
  },
  attention: {
    label: 'Attention',
    sections: { sua_vez: 'Your turn', pendente: 'Pending', encaminhado: 'Forwarded' },
    blocked: 'Bloq.',
    motives: {
      sessao_aguardando: 'AI waiting',
      voltou: 'Back',
      desbloqueada: 'Unblocked',
      atribuida: 'Assigned',
      bloqueada: 'Blocked',
      aguardando_outro: 'Waiting on someone',
      parada_no_projeto: 'Stalled in a project'
    }
  },
  homeView: {
    layout: 'Home layout',
    list: 'List',
    kanban: 'Kanban',
    done: 'Done',
    stalled: (n: number): string => (n === 1 ? '1 stalled in projects' : `${n} stalled in projects`)
  },
  shortcuts: {
    title: 'Shortcuts',
    capture: 'Press Ctrl+Shift and the new key',
    unbound: '—',
    close: 'Close'
  },
  header: {
    menu: 'Task menu',
    next: 'Next',
    lastRecord: 'Last record',
    noSummary: 'No summary',
    stoppedAt: 'Stopped at',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    closeWhileWorking: 'The AI is working. Close the task anyway?'
  },
  menu: {
    record: 'Record',
    sessions: 'Sessions',
    workdir: 'Working folder',
    'previous-stage': 'Previous stage',
    move: 'Move',
    block: 'Block',
    unblock: 'Unblock',
    close: 'Close'
  },
  commands: {
    search: 'Search',
    new: 'New',
    newTab: 'New tab',
    split: 'Split',
    closeTab: 'Close tab',
    sidebar: 'Sidebar',
    copy: 'Copy',
    paste: 'Paste',
    draft: 'Draft',
    sync: 'Sync',
    shortcuts: 'Shortcuts',
    'panel-prev': 'Previous panel',
    'panel-next': 'Next panel',
    'cycle-prev': 'Previous tab',
    'cycle-next': 'Next tab',
    tab: (n: number): string => `Tab ${n}`,
    assistant: 'Assistant',
    hub: 'Hub',
    talk: 'Talk'
  },
  brainView: {
    toggle: 'Switch between the README and the terminal',
    readme: 'README',
    terminal: 'Terminal',
    session: (alive: boolean): string => `Session ${alive ? 'running' : 'ended'}.`,
    toTerminal: 'Go to terminal'
  },
  undo: 'Undo',
  syncOff: 'Sync is not connected yet.'
} as const
