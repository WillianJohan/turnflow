import { newId } from '../../ids'
import type { Db } from '../open'
import type { Migration } from '../migrate'

type SeedStage = { name: string; short: string; waitsOther?: boolean }
type SeedFlow = { name: string; icon: string; syncs: boolean; stages: SeedStage[] }

// Semente dos fluxos padrão (§4/§15.13). A última etapa de cada fluxo é a final.
const SEED: SeedFlow[] = [
  {
    name: 'Feature',
    icon: 'sparkles',
    syncs: true,
    stages: [
      { name: 'Refinamento', short: 'Ref.' },
      { name: 'Implementação', short: 'Impl.' },
      { name: 'Review', short: 'Review', waitsOther: true },
      { name: 'Entregue', short: 'Entr.' }
    ]
  },
  {
    name: 'Bugfix',
    icon: 'bug',
    syncs: true,
    stages: [
      { name: 'Reproduzir', short: 'Repr.' },
      { name: 'Corrigir', short: 'Corr.' },
      { name: 'Review', short: 'Review', waitsOther: true },
      { name: 'Entregue', short: 'Entr.' }
    ]
  },
  {
    name: 'Pessoal',
    icon: 'user',
    syncs: false,
    stages: [
      { name: 'A fazer', short: 'A fazer' },
      { name: 'Fazendo', short: 'Fazendo' },
      { name: 'Feito', short: 'Feito' }
    ]
  }
]

function seed(db: Db): void {
  const flow = db.prepare('insert into flow(id, name, is_default) values (?, ?, ?)')
  const stage = db.prepare(
    `insert into flow_stage(id, flow_id, position, name, short_name, waits_other, is_final)
     values (?, ?, ?, ?, ?, ?, ?)`
  )
  const type = db.prepare(
    'insert into task_type(id, name, flow_id, syncs, icon) values (?, ?, ?, ?, ?)'
  )
  SEED.forEach((f, i) => {
    const flowId = newId()
    flow.run(flowId, f.name, i === 0 ? 1 : 0)
    f.stages.forEach((s, n) =>
      stage.run(
        newId(),
        flowId,
        n + 1,
        s.name,
        s.short,
        s.waitsOther ? 1 : 0,
        n === f.stages.length - 1 ? 1 : 0
      )
    )
    type.run(newId(), f.name, flowId, f.syncs ? 1 : 0, f.icon)
  })
}

// Esquema do domínio da §4 (+ activity.data, sync_outbox.created_at e key_seq, Decisões 2-4 do E3).
// activity.client_id precisa de mcp_client, que precisa de ai_session; o SQLite não adiciona FK
// depois, por isso as três nascem juntas. O trigger sync_outbox_no_personal impede que task do
// tipo `syncs = 0` ganhe fila de sincronização.
export const domain: Migration = {
  version: 4,
  name: 'domain',
  up: (db) => {
    db.exec(`
      create unique index flow_one_default on flow(is_default) where is_default = 1;

      create table project_item(
        id text primary key,
        project_id text not null references project(id) on delete cascade,
        rank text not null,
        kind text not null check(kind in ('task', 'divider')),
        task_id text unique references task(id) on delete cascade,
        label text,
        due_date text
      );
      create index project_item_rank on project_item(project_id, rank);

      create table ai_session(
        id text primary key,
        task_id text references task(id) on delete set null,
        tool text not null,
        external_id text,
        cwd text,
        state text not null default 'unknown' check(state in ('working', 'waiting', 'idle', 'unknown')),
        state_at text not null,
        started_at text not null,
        ended_at text,
        label text,
        unique(tool, external_id)
      );
      create index ai_session_live on ai_session(task_id) where ended_at is null;

      create table mcp_client(
        id text primary key,
        kind text not null check(kind in ('client', 'session')),
        name text,
        token_hash text,
        ai_session_id text references ai_session(id),
        scopes text,
        last_used_at text,
        revoked_at text,
        check((kind = 'client' and token_hash is not null) or (kind = 'session' and ai_session_id is not null))
      );

      create table activity(
        id text primary key,
        at text not null,
        actor text not null check(actor in ('user', 'mcp', 'sync', 'assistant', 'import')),
        client_id text references mcp_client(id),
        op text not null,
        task_id text not null references task(id) on delete cascade,
        inverse text,
        data text,
        undone_at text,
        undone_by_activity_id text references activity(id)
      );
      create index activity_task on activity(task_id, id);

      create table sync_outbox(
        id text primary key,
        task_id text not null references task(id) on delete cascade,
        op text not null check(op in ('transition', 'comment', 'assign')),
        payload text,
        idem_key text not null unique,
        attempts integer not null default 0,
        next_at text,
        locked_at text,
        last_error text,
        done_at text,
        cancelled_at text,
        created_at text not null
      );
      create trigger sync_outbox_no_personal before insert on sync_outbox
      when exists (
        select 1 from task t join task_type y on y.id = t.type_id
        where t.id = new.task_id and y.syncs = 0
      )
      begin
        select raise(abort, 'personal_no_sync');
      end;

      create table key_seq(
        prefix text primary key,
        last integer not null
      )`)
    seed(db)
  }
}
