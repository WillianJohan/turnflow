import type { Migration } from '../migrate'

// Colunas da §4 do refinamento. Sem semente: fluxos e tipos padrão são do E3.
export const taskCore: Migration = {
  version: 2,
  name: 'task_core',
  up: (db) =>
    db.exec(`
      create table flow(
        id text primary key,
        name text not null,
        is_default integer not null default 0 check(is_default in (0, 1))
      );
      create table flow_stage(
        id text primary key,
        flow_id text not null references flow(id),
        position integer not null,
        name text not null,
        short_name text not null,
        waits_other integer not null default 0 check(waits_other in (0, 1)),
        is_final integer not null default 0 check(is_final in (0, 1)),
        remote_star_status text,
        deleted_at text
      );
      create table task_type(
        id text primary key,
        name text not null,
        flow_id text not null references flow(id),
        guideline text,
        syncs integer not null default 1 check(syncs in (0, 1)),
        icon text
      );
      create table project(
        id text primary key,
        name text not null,
        goal text,
        color text,
        flow_id text references flow(id),
        done_at text,
        remote_connector_id text,
        remote_epic_id text
      );
      create table task(
        id text primary key,
        key text not null unique,
        title text not null,
        description text,
        type_id text references task_type(id),
        flow_id text references flow(id),
        stage_id text references flow_stage(id),
        project_id text references project(id),
        workdir text,
        blocked_reason text,
        blocked_at text,
        turn_reason text check(turn_reason is null or turn_reason in ('voltou', 'desbloqueada', 'atribuida')),
        turn_at text,
        sum_what text,
        sum_where text,
        sum_next text,
        sum_at text,
        sum_source text check(sum_source is null or sum_source in ('ai', 'user', 'engine')),
        touched_at text,
        done_at text,
        deleted_at text,
        created_at text not null
      );
      create table checkpoint(
        id text primary key,
        task_id text not null references task(id) on delete cascade,
        at text not null,
        text text not null,
        source text not null check(source in ('user', 'ai', 'sync', 'import')),
        remote_comment_id text,
        text_hash text
      );
      create index checkpoint_task on checkpoint(task_id, at)`)
}
