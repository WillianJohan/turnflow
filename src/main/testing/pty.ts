import type { PtySpawner } from '../pty'

const baseName = (file: string): string => {
  const name = file.split(/[/\\]/).pop() ?? file
  return name.replace(/\.exe$/i, '')
}

/**
 * Com `TURNFLOW_TEST_PTY=<script>`, troca o binário do agente por `bash` rodando o script,
 * com o mesmo cwd, env e tamanho. Shell passa direto. Sem a variável, devolve o spawner real.
 */
export function testSpawner(
  env: NodeJS.ProcessEnv,
  real: PtySpawner,
  agentBins: () => string[]
): PtySpawner {
  const script = env.TURNFLOW_TEST_PTY
  if (!script) return real
  return (file, args, o) => {
    const names = new Set(['claude', ...agentBins().map(baseName)])
    if (names.has(baseName(file))) return real('bash', ['--norc', '--noprofile', script], o)
    return real(file, args, o)
  }
}
