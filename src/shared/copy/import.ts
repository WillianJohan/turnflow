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
    legacy_not_found: 'The legacy source was not found.',
    export_dest_invalid: 'The export destination is not a valid folder.',
    status_map_newer_version:
      'The status map was saved by a newer version of the app and will not be overwritten.',
    flow_has_no_stages: 'This flow has no stages to map statuses to.'
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
