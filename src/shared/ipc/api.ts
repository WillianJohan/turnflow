// Tipo de window.turnflow, inferido do registro. Só tipos: nada daqui vira código no preload.
import type { z } from 'zod'
import type { Channel } from './define'
import type { Events, EVENTS } from './events'
import type { Channels } from './registry'
import type { Result } from './result'

type Input<C extends Channel> = z.input<C['input']>
type Method<C extends Channel> = C['kind'] extends 'send'
  ? (input: Input<C>) => void
  : (input: Input<C>) => Promise<Result<z.output<C['output']>>>

export type RendererApi = { [K in keyof Channels]: Method<Channels[K]> } & {
  [K in keyof typeof EVENTS]: (cb: (...args: Events[(typeof EVENTS)[K]]) => void) => () => void
} & { pathForFile(file: File): string }
