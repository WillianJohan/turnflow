import type { Migration } from '../migrate'

// Esquema do import (E4). A identidade é a key da task, não o path (Decisão 1 do E4);
// `task_id` NULL = task apagada no app, e o registro vira tombstone (Decisão 16).
export const importSchema: Migration = {
  version: 5,
  name: 'import',
  up: (db) =>
    db.exec(`
      create table import_record(
        source_key text primary key,
        source_path text not null,
        task_id text references task(id) on delete set null,
        file_hash text not null,
        field_hashes text not null,
        imported_at text not null
      );
      create index import_record_task on import_record(task_id);

      create table import_project(
        source_key text primary key,
        project_id text references project(id) on delete set null,
        imported_at text not null
      )`)
}
