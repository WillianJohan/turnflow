import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Boot } from '../../../../shared/ipc/vault'
import { orThrow, unwrap } from '../../ipc'
import { COPY } from './copy'
import { clearClipboardIf, gateReducer, initialGate, screenFor, withoutChannel } from './form'
import { Failed } from './Failed'
import { NewPassword } from './NewPassword'
import { Recover } from './Recover'
import { Restore } from './Restore'
import { RecoveryWords } from './RecoveryWords'
import { Unlock } from './Unlock'
import { WipeAll } from './WipeAll'
import './vault.css'

const message = (e: unknown): string => withoutChannel(e instanceof Error ? e.message : String(e))

/**
 * Portão do cofre: fronteira de segurança do renderer. Até o banco estar `ready` só as telas de
 * primeiro uso/desbloqueio existem; `children` (o app e seus canais de dados) nem monta.
 */
export function VaultGate({ children }: { children: ReactNode }): React.JSX.Element {
  const api = window.turnflow
  const [{ boot, mode }, dispatch] = useReducer(gateReducer, initialGate)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [words, setWords] = useState<string[] | null>(null)
  const [beginError, setBeginError] = useState<string | null>(null)
  const begun = useRef(false)

  const fetchBoot = useCallback(
    (t: 'initial' | 'result'): void => {
      orThrow(api.bootGet()).then(
        (b) => {
          setLoadError(null)
          dispatch({ t, boot: b })
        },
        (e) => setLoadError(message(e))
      )
    },
    [api]
  )
  const retryBoot = useCallback(() => fetchBoot('result'), [fetchBoot])
  const applyResult = useCallback((b: Boot) => dispatch({ t: 'result', boot: b }), [])
  // tela de falha: o main refaz o boot (o wipe interrompido termina, o banco reaberto)
  const retryVault = useCallback(
    () =>
      orThrow(api.vaultRetry()).then(
        (b) => {
          setLoadError(null)
          applyResult(b)
        },
        (e) => setLoadError(message(e))
      ),
    [api, applyResult]
  )

  useEffect(() => {
    fetchBoot('initial')
    return api.onVaultChanged((b) => dispatch({ t: 'event', boot: b }))
  }, [api, fetchBoot])

  // chaveiro de verdade: sem senha, as palavras saem direto do begin
  const beginKeyring = useCallback((): void => {
    begun.current = true
    orThrow(api.firstRunBegin({})).then(
      (r) => setWords(r.words),
      (e) => setBeginError(message(e))
    )
  }, [api])
  useEffect(() => {
    // saiu do primeiro uso: um Apagar tudo depois (no mesmo processo) precisa de um begin novo
    if (boot && boot.state !== 'first_run') begun.current = false
    if (boot?.state === 'first_run' && boot.backend === 'real' && !begun.current) beginKeyring()
  }, [boot, beginKeyring])

  const wipeClipboard = useCallback(
    (text: string): void => {
      void clearClipboardIf(
        text,
        () => unwrap(api.readClipboard()).then((c) => c?.text),
        () => api.writeClipboard({ text: '' })
      )
    },
    [api]
  )

  if (!boot)
    return (
      <div className="vault">
        {loadError ? (
          <Failed message={loadError} onRetry={retryBoot} />
        ) : (
          <p className="vault-hint">{COPY.loading}</p>
        )}
      </div>
    )

  const screen = screenFor(boot, mode, words)
  if (screen === 'app') return <>{children}</>
  const toRestore = (): void => dispatch({ t: 'mode', mode: 'restore' })
  const toWipe = (): void => dispatch({ t: 'mode', mode: 'wipe' })
  const toDefault = (): void => dispatch({ t: 'mode', mode: 'default' })

  return (
    <div className="vault">
      {screen === 'new_password' && (
        <NewPassword
          onSubmit={(password) =>
            orThrow(api.firstRunBegin({ password })).then((r) => setWords(r.words))
          }
          onRestore={toRestore}
        />
      )}
      {screen === 'words' && (
        <RecoveryWords
          words={words}
          error={beginError}
          onRetry={() => {
            setBeginError(null)
            beginKeyring()
          }}
          onCopy={(text) => api.writeClipboard({ text })}
          onWipe={wipeClipboard}
          onSave={() => orThrow(api.firstRunSaveWords()).then((r) => r?.path ?? null)}
          onContinue={() =>
            orThrow(api.firstRunCommit({ saved: true })).then((b) => {
              setWords(null)
              applyResult(b)
            })
          }
          onRestore={toRestore}
        />
      )}
      {screen === 'unlock' && (
        <Unlock
          onUnlock={(password) => orThrow(api.vaultUnlock({ password })).then(applyResult)}
          onRecover={() => dispatch({ t: 'mode', mode: 'recover' })}
          onForgot={toWipe}
        />
      )}
      {screen === 'recover' && (
        <Recover
          boot={boot}
          onRecover={(w, newPassword) =>
            orThrow(api.vaultRecover({ words: w, newPassword })).then(applyResult)
          }
          onBack={toDefault}
          onForgot={toWipe}
        />
      )}
      {screen === 'restore' && (
        <Restore
          boot={boot}
          onPick={() => orThrow(api.firstRunPickBackup()).then((r) => r?.path ?? null)}
          onRestore={(backupPath, w, password) =>
            orThrow(api.firstRunRestore({ backupPath, words: w, password })).then((b) => {
              setWords(null) // palavras de um begin anterior não valem para o banco restaurado
              applyResult(b)
            })
          }
          onBack={() => dispatch({ t: 'mode', mode: 'default' })}
        />
      )}
      {screen === 'wipe' && (
        <WipeAll
          onWipe={(confirm) => orThrow(api.vaultWipe({ confirm })).then(applyResult)}
          onBack={toDefault}
        />
      )}
      {screen === 'failed' && (
        <Failed
          message={loadError ?? boot.failure?.message ?? ''}
          onRetry={retryVault}
          onWipe={toWipe}
        />
      )}
    </div>
  )
}
