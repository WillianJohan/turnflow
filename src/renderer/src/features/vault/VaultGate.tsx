import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Boot } from '../../../../shared/ipc/vault'
import { orThrow } from '../../ipc'
import { COPY } from './copy'
import { screenFor, withoutChannel, type Mode } from './form'
import { Failed } from './Failed'
import { NewPassword } from './NewPassword'
import { Recover } from './Recover'
import { RecoveryWords } from './RecoveryWords'
import { Unlock } from './Unlock'
import './vault.css'

const message = (e: unknown): string => withoutChannel(e instanceof Error ? e.message : String(e))

/**
 * Portão do cofre: fronteira de segurança do renderer. Até o banco estar `ready` só as telas de
 * primeiro uso/desbloqueio existem; `children` (o app e seus canais de dados) nem monta.
 */
export function VaultGate({ children }: { children: ReactNode }): React.JSX.Element {
  const api = window.turnflow
  const [boot, setBoot] = useState<Boot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('default')
  const [words, setWords] = useState<string[] | null>(null)
  const [beginError, setBeginError] = useState<string | null>(null)
  const begun = useRef(false)

  const fetchBoot = useCallback((): void => {
    orThrow(api.bootGet()).then(
      (b) => {
        setLoadError(null)
        setBoot(b)
      },
      (e) => setLoadError(message(e))
    )
  }, [api])

  useEffect(() => {
    fetchBoot()
    return api.onVaultChanged(setBoot)
  }, [api, fetchBoot])

  // chaveiro de verdade: sem senha, as palavras saem direto do begin
  useEffect(() => {
    if (boot?.state !== 'first_run' || boot.backend !== 'real' || begun.current) return
    begun.current = true
    orThrow(api.firstRunBegin({})).then(
      (r) => setWords(r.words),
      (e) => setBeginError(message(e))
    )
  }, [api, boot])

  if (!boot)
    return (
      <div className="vault">
        {loadError ? (
          <Failed message={loadError} onRetry={fetchBoot} />
        ) : (
          <p className="vault-hint">{COPY.loading}</p>
        )}
      </div>
    )

  const screen = screenFor(boot, mode, words)
  if (screen === 'app') return <>{children}</>

  return (
    <div className="vault">
      {screen === 'new_password' && (
        <NewPassword
          onSubmit={(password) =>
            orThrow(api.firstRunBegin({ password })).then((r) => setWords(r.words))
          }
        />
      )}
      {screen === 'words' && (
        <RecoveryWords
          words={words}
          error={beginError}
          onCopy={() => words && api.writeClipboard({ text: words.join(' ') })}
          onSave={() => orThrow(api.firstRunSaveWords()).then((r) => r?.path ?? null)}
          onContinue={() =>
            orThrow(api.firstRunCommit({ saved: true })).then((b) => {
              setWords(null)
              setBoot(b)
            })
          }
        />
      )}
      {screen === 'unlock' && (
        <Unlock
          onUnlock={(password) => orThrow(api.vaultUnlock({ password })).then(setBoot)}
          onRecover={() => setMode('recover')}
        />
      )}
      {screen === 'recover' && (
        <Recover
          boot={boot}
          onRecover={(w, newPassword) =>
            orThrow(api.vaultRecover({ words: w, newPassword })).then(setBoot)
          }
          onBack={() => setMode('default')}
        />
      )}
      {screen === 'failed' && <Failed message={boot.failure?.message ?? ''} onRetry={fetchBoot} />}
    </div>
  )
}
