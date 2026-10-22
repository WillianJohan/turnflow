import { BRAND } from '../brand'

// Textos do import de markdown. Os Tasks 8–10 do E4 acrescentam os textos das telas.

export const IMPORT_COPY = {
  /** Resumo da Atividade `task_import` (lido por `DOMAIN_COPY.summary`). */
  activity: { created: 'imported from markdown', updated: 'updated by import' },
  errors: {
    import_root_invalid:
      'This folder is not a valid brain folder: it needs an absolute path with a current, backlog or done folder.',
    too_many_tasks: 'This folder has too many tasks to import at once.',
    too_large: 'The task READMEs in this folder are too large to read at once.',
    preview_stale: 'The folder changed since the preview. Preview it again before importing.',
    app_config_invalid:
      'The settings file of this app is not valid JSON. Fix or remove it before importing.',
    legacy_not_found: 'The legacy source was not found.',
    export_dest_invalid: 'The export destination is not a valid folder.',
    status_map_newer_version:
      'The status map was saved by a newer version of the app and will not be overwritten.',
    flow_has_no_stages: 'This flow has no stages to map statuses to.'
  },
  /** Avisos do relatório: o import foi gravado, mas uma escrita depois dele falhou. */
  warnings: {
    status_map_not_saved:
      'The tasks were imported, but the status choices could not be saved for the next import.',
    brain_dir_not_saved:
      'The tasks were imported, but the brain folder could not be saved in the settings.'
  },
  /** Tela de import do brain (Ajustes → Import). */
  screen: {
    title: 'Import',
    intro:
      'Import tasks from a brain folder of markdown READMEs. The folder is only read, never changed.',
    folder: 'Brain folder',
    browse: 'Browse…',
    preview: 'Preview',
    previewing: 'Reading the folder…',
    apply: 'Apply',
    applying: 'Importing…',
    previewRefreshed:
      'The folder changed since the preview. The preview was refreshed: check it and apply again.',
    type: 'Task type',
    /** Tipo da prévia que a lista de tipos não trouxe (lista falhou ou tipo fora dela). */
    defaultType: 'Default type',
    counts: {
      create: 'To create',
      update: 'To update',
      link: 'To link',
      record_only: 'Record only',
      unchanged: 'Unchanged',
      deleted_in_app: 'Deleted in the app',
      invalid: 'Invalid',
      conflicts: 'Conflicts'
    },
    statuses: 'Statuses',
    statusCol: 'Status',
    tasksCol: 'Tasks',
    stageCol: 'Stage',
    stageFor: (status: string): string => `Stage for "${status}"`,
    notMapped: 'Not mapped: first stage, with an imported-status checkpoint',
    missingStage: (name: string): string => `${name} (stage no longer exists)`,
    roles: {
      first: 'First stage',
      working: 'Working stage',
      review: 'Review stage',
      final: 'Final stage',
      blocked: 'Blocked'
    },
    mapProblem: {
      unreadable: 'The saved status choices could not be read and were ignored.',
      invalid: 'The saved status choices are invalid and were ignored.',
      newer_version:
        'The saved status choices come from a newer version of the app and were ignored.'
    },
    mapDropped: (n: number): string =>
      n === 1
        ? '1 saved status choice was invalid and was ignored.'
        : `${n} saved status choices were invalid and were ignored.`,
    tasks: 'Tasks',
    noTasks: 'No tasks found in this folder.',
    actions: {
      create: 'Create',
      update: 'Update',
      link: 'Link to the existing task',
      record_only: 'Record only',
      unchanged: 'Unchanged',
      deleted_in_app: 'Deleted in the app, not restored',
      invalid: 'Invalid'
    },
    fields: { title: 'Title', description: 'Description', project: 'Project', stage: 'Stage' },
    conflict: (key: string, field: string): string => `${key}: ${field} changed on both sides`,
    keepApp: `Keep ${BRAND.name}`,
    useMarkdown: 'Use markdown',
    workdirSuggestion: (dir: string): string => `Use ${dir} as the working folder`,
    attachments: (n: number): string => `Pending attachments (${n})`,
    /** Motivo de task inválida (`too_long:<campo>` do plano); desconhecido cai no genérico. */
    reasons: {
      tooLong: (what: string): string => `${what} is too long to import.`,
      unknown: 'This task cannot be imported.'
    },
    tooLongFields: {
      title: 'The title',
      description: 'The description',
      checkpoint: 'A checkpoint',
      blocked_reason: 'The blocked reason',
      workdir: 'The working folder',
      project: 'The project name'
    },
    size: {
      b: (n: number): string => `${n} B`,
      kb: (n: string): string => `${n} KB`,
      mb: (n: string): string => `${n} MB`
    },
    ignoredWhy: (why: string): string => `— ${why}`,
    attachmentsHint: 'Attachments are listed only; they are not imported.',
    ignoredList: (n: number): string => `Ignored (${n})`,
    reportTitle: 'Import finished',
    report: {
      created: 'Created',
      updated: 'Updated',
      linked: 'Linked',
      record_only: 'Record only',
      unchanged: 'Unchanged',
      checkpoints_added: 'Checkpoints added',
      sessions_added: 'Sessions added',
      links_added: 'Links added',
      projects_created: 'Projects created'
    },
    conflictsKept: (n: number): string => `Conflicts kept with the app value: ${n}`,
    takenMarkdown: (n: number): string => `Conflicts resolved with markdown: ${n}`,
    deletedInApp: (keys: string): string => `Deleted in the app, not restored: ${keys}`,
    invalidTask: (key: string, why: string): string => `${key} was not imported. ${why}`,
    sessionTaken: (id: string, key: string): string =>
      `Session ${id} already belongs to ${key} and stays there.`
  },
  /** Migração dos temas e da config do app legado (Ajustes → Import). */
  legacy: {
    button: 'Import from dkdesk',
    intro:
      'Copy the themes and basic settings from the old app. Its folder is only read; your layout, statuses and tasks are not touched.',
    previewing: 'Reading the old app folder…',
    apply: 'Apply',
    applying: 'Importing…',
    themes: 'Themes',
    settings: 'Settings',
    noThemes: 'No themes found.',
    nothing: 'Nothing new to import.',
    ignored: (keys: string): string => `Not migrated: ${keys}`,
    actions: {
      create: (to: string): string => `Will be copied as "${to}"`,
      skip_same: (to: string): string => `Already here as "${to}"`,
      skip_builtin: 'Built-in theme, skipped',
      skip_invalid: 'Not a valid theme, skipped'
    },
    previewRefreshed:
      'The old app folder changed since the preview. The preview was refreshed: check it and apply again.',
    done: (themes: number, keys: number): string =>
      `Imported ${themes} ${themes === 1 ? 'theme' : 'themes'} and ${keys} ${keys === 1 ? 'setting' : 'settings'}.`,
    skippedFiles: (ids: string): string => `Already existed and were left as they are: ${ids}`
  },
  importedStatus: (status: string): string => `Imported status: ${status}`,
  /** Por que um caminho ficou de fora do import. */
  ignored: {
    credentials: 'Credentials are never read.',
    symlink: 'Symbolic links are not followed.',
    too_large: 'The README is too large to import.',
    not_a_key: 'The folder name is not a task key.',
    no_readme: 'The task folder has no README.md.',
    duplicate: 'Another folder already provides this task key.',
    unreadable: 'The file or folder could not be read.',
    loose_file: 'Only task folders are imported; this file is not inside one.',
    skipped_dir: 'Hidden and dependency folders are not scanned.',
    truncated: 'Too many items to list; the rest were counted but not listed.'
  }
} as const
