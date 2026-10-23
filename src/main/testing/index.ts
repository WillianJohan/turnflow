// Só entra no build de teste (import atrás de `if (__TURNFLOW_TEST__)`); o release não pode conter nada daqui.
export function installTestHooks(): void {
  process.env.TURNFLOW_TEST_MARK = 'TURNFLOW_TEST_MARK'
}
