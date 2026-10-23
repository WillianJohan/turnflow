// Textos novos de sessão, em inglês. O pt-BR do domínio herdado fica até o E6.9.

export const SESSION_COPY = {
  errors: {
    session_live: 'This session is already open',
    session_has_task: 'This session already belongs to a task',
    workdir_required: 'Choose a working folder first',
    workdir_missing: 'That working folder does not exist',
    cwd_gone: 'The session folder no longer exists',
    transcript_missing: 'The session transcript was not found',
    open_in_app: 'This conversation is already open in the app',
    running_elsewhere: 'This conversation is open outside the app',
    not_resumable: 'This agent cannot resume a session',
    agent_not_configured: 'That agent is not configured',
    pty_busy: 'The previous process is still shutting down'
  },
  activity: {
    adopt: 'Session adopted',
    end: 'Session ended'
  },
  clientName: (tool: string, key: string | null): string =>
    `session ${tool}${key ? ` · ${key}` : ''}`
} as const
