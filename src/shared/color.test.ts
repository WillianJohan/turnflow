import { expect, it } from 'vitest'
import { oscRgb } from './color'

it('hex vira formato de resposta OSC', () => expect(oscRgb('#14161a')).toBe('rgb:1414/1616/1a1a'))
it('hex curto', () => expect(oscRgb('#fff')).toBe('rgb:ffff/ffff/ffff'))
it('inválido → null', () => expect(oscRgb('azul')).toBeNull())
