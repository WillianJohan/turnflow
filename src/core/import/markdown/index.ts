import type { ImportPreview, ImportReport } from '../../../shared/contracts'
import type { DomainDeps } from '../../domain/context'
import { applyImport } from './apply'
import { planImport, type ImportOptions } from './plan'
import { nodeBrainFs, scanBrain, type BrainFs } from './scan'

// Entrada do import do brain: prévia e apply sempre leem a pasta de novo. O apply refaz o plano e
// só escreve se o `token` ainda é o da prévia (senão `CONFLICT preview_stale`).

export async function previewBrain(
  d: DomainDeps,
  root: string,
  o: ImportOptions,
  fs: BrainFs = nodeBrainFs
): Promise<ImportPreview> {
  return planImport(d, await scanBrain(root, fs), o).preview
}

export async function applyBrain(
  d: DomainDeps,
  root: string,
  o: ImportOptions,
  token: string,
  fs: BrainFs = nodeBrainFs
): Promise<ImportReport> {
  const scan = await scanBrain(root, fs)
  // plano e apply sem `await` entre eles: o banco não muda no meio
  return applyImport(d, planImport(d, scan, o), token)
}
