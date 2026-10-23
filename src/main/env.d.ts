// true só no build de teste (`npm run build:test`); no release o bundler troca por false e elimina o ramo.
declare const __TURNFLOW_TEST__: boolean
