import type { Migration } from '../migrate'

export const base: Migration = {
  version: 1,
  name: 'base',
  up: (db) =>
    db.exec(`
      create table secret(
        name text primary key,
        service text not null,
        value text not null,
        allow_hosts text,
        inject text,
        created_at text not null,
        last_used_at text
      )`)
}
