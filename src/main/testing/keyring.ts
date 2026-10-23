// Só entra no build de teste (import atrás de `if (__TURNFLOW_TEST__)` no keychain.ts).
import type { KeyBackend } from '../../core/key/backend'
import { fakeKeyBackend } from '../../core/testing/fakeKeyBackend'

export const testKeyBackend = (kind: 'real' | 'basic_text'): KeyBackend => fakeKeyBackend(kind)
