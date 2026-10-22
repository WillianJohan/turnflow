import type { Migration } from '../migrate'

// Decisão 7: tabela própria (não external content) com cópia do texto, mantida por triggers.
// O trigram com remove_diacritics casa sem acento e sem caixa, e o snippet devolve o texto original.
// Task com deleted_at continua indexada: a consulta filtra, e o Desfazer não precisa reindexar.
export const search: Migration = {
  version: 3,
  name: 'search',
  up: (db) =>
    db.exec(`
      create virtual table search_fts using fts5(
        kind unindexed, ref_id unindexed, task_id unindexed, title, body,
        tokenize = 'trigram remove_diacritics 1'
      );
      insert into search_fts(search_fts, rank) values('secure-delete', 1);

      create trigger task_fts_ai after insert on task begin
        insert into search_fts(kind, ref_id, task_id, title, body)
        values ('task', new.id, new.id, new.title, coalesce(new.description, ''));
      end;
      create trigger task_fts_au after update of title, description on task begin
        delete from search_fts where kind = 'task' and ref_id = old.id;
        insert into search_fts(kind, ref_id, task_id, title, body)
        values ('task', new.id, new.id, new.title, coalesce(new.description, ''));
      end;
      create trigger task_fts_ad after delete on task begin
        delete from search_fts where kind = 'task' and ref_id = old.id;
      end;

      create trigger checkpoint_fts_ai after insert on checkpoint begin
        insert into search_fts(kind, ref_id, task_id, title, body)
        values ('checkpoint', new.id, new.task_id, '', new.text);
      end;
      create trigger checkpoint_fts_au after update of text on checkpoint begin
        delete from search_fts where kind = 'checkpoint' and ref_id = old.id;
        insert into search_fts(kind, ref_id, task_id, title, body)
        values ('checkpoint', new.id, new.task_id, '', new.text);
      end;
      create trigger checkpoint_fts_ad after delete on checkpoint begin
        delete from search_fts where kind = 'checkpoint' and ref_id = old.id;
      end;

      insert into search_fts(kind, ref_id, task_id, title, body)
        select 'task', id, id, title, coalesce(description, '') from task;
      insert into search_fts(kind, ref_id, task_id, title, body)
        select 'checkpoint', id, task_id, '', text from checkpoint`)
}
