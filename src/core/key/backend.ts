/**
 * Onde a DEK fica embrulhada no modo keyring. `real` = chaveiro do SO protege de verdade;
 * `basic_text` = não protege (nesse caso o vault usa senha mestra).
 * `decrypt` lança quando não consegue decifrar.
 */
export interface KeyBackend {
  kind(): 'real' | 'basic_text'
  encrypt(plain: Buffer): Buffer
  decrypt(blob: Buffer): Buffer
}
