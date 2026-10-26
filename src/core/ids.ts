import { monotonicFactory } from 'ulid'

const factory = monotonicFactory()

/** ULID monotônico: dentro do mesmo ms o id cresce, então ordenar por id é ordenar por tempo. */
export function newId(): string {
  return factory()
}
