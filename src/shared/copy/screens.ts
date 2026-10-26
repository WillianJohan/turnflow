// Textos das telas herdadas (rascunho, cabeçalho do brain, avulsas, Ajustes e editor de tema), em
// inglês. O E6.9 traduz.

export const SCREENS_COPY = {
  composer: {
    placeholder: 'Draft mode: Enter adds a line · Ctrl+Enter sends · Ctrl+Shift+D turns it off',
    lost: 'session ended — draft kept',
    status: (lines: number | null): string =>
      `✎ draft · ${lines === null ? 'empty' : `${lines} ${lines === 1 ? 'line' : 'lines'}`}`,
    send: 'Send ⏎'
  },
  brainHeader: {
    toggle: (open: boolean): string => (open ? 'Collapse summary' : 'Show summary'),
    sessions: 'Sessions',
    noSessions: 'no saved sessions',
    regenerate: 'Generate the summary again',
    endHint: 'Kills the process; the conversation is kept',
    end: 'End session',
    what: 'What it is',
    where: 'Stopped at',
    next: 'Next',
    empty: 'no summary yet',
    loading: 'generating summary…'
  },
  iconPicker: {
    title: 'Choose icon',
    emoji: 'Emoji',
    icons: 'Icons',
    remove: 'Remove',
    search: 'Search…',
    custom: 'Other color',
    none: 'nothing found'
  },
  scratch: {
    title: (claude: boolean, dir: string): string =>
      `${claude ? 'Claude without a task' : 'terminal'} in ${dir}`,
    adoptPlaceholder: 'T-1',
    endHint: 'Kills the process',
    end: 'End',
    exited: 'The process exited.',
    reopen: 'Reopen'
  },
  settings: {
    tabs: 'Settings',
    settings: 'Settings',
    design: 'Design system',
    heading: 'Settings',
    theme: 'Theme',
    yours: ' · yours',
    fonts: 'Fonts',
    terminal: 'Terminal',
    size: 'Size',
    app: 'App',
    default: 'Default',
    notifications: 'Notifications',
    notify:
      'Notify in the system when a Claude asks for permission or finishes and you are not looking at that tab',
    draft: 'Draft',
    draftHint: 'Draft mode: a draft box under the terminal (Enter adds a line, Ctrl+Enter sends) ·',
    statusIcons: 'Status icons',
    chooseIcon: 'Choose icon',
    files: 'Files',
    filesIn: 'Everything lives in',
    filesAnd: 'and',
    filesApply: '. Edit and save, the app applies it right away.',
    openDir: 'Open config folder'
  },
  themeEditor: {
    default: 'default',
    name: 'Name',
    save: 'Save',
    saveAsHint: (id: string): string => `Writes themes/${id}.json and turns it on`,
    saveAs: 'Save as new',
    discard: 'Discard',
    remove: 'Delete theme',
    builtin: 'Built-in theme: your changes become a new theme when you save.',
    ui: 'Interface',
    terminal: 'Terminal',
    ansi: '16 ANSI colors'
  }
} as const
