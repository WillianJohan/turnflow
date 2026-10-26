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
    pty_busy: 'The previous process is still shutting down',
    unsafe_batch_arg: 'This launch argument cannot be passed safely to a .cmd launcher'
  },
  activity: {
    adopt: 'Session adopted',
    end: 'Session ended'
  },
  clientName: (tool: string, key: string | null): string =>
    `session ${tool}${key ? ` · ${key}` : ''}`,
  initialPrompt: (key: string, title: string, server: string): string =>
    `We're working on task ${key}: ${title}\n\n` +
    `Before anything else, call the guidelines_get and task_get tools from the ${server} MCP server.`,
  // Lançador .cmd/.bat (Windows): o cmd.exe reinterpreta o argv, então vai só a key, sem título
  // nem descrição; o task_get entrega o resto.
  initialPromptBatch: (key: string, server: string): string =>
    `We're working on task ${key}. ` +
    `Before anything else, call the guidelines_get and task_get tools from the ${server} MCP server.`,
  descriptionIntro: '\n\nTask description:\n',
  descriptionCut: '\n\n[Description truncated. Read the rest with task_get.]',
  notImported: 'Import this task to open sessions',
  endWhileWorking: 'The AI is working. End the session anyway?',
  pickWorkdir: 'Choose the working folder for this task',
  adopt: 'Adopt into task',
  resume: 'Resume',
  newSession: 'New session',
  sessionOpen: 'session open'
} as const
