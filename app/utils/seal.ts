import type { MainModule } from 'node-seal'
import sealWasmUrl from '../../node_modules/node-seal/dist/seal_throws.wasm?url'

let sealPromise: Promise<MainModule> | undefined

export function getClientSEAL(): Promise<MainModule> {
  sealPromise ??= import('node-seal/throws').then(({ default: initializeSEAL }) => initializeSEAL({
    locateFile: path => path.endsWith('.wasm') ? sealWasmUrl : path
  }))

  return sealPromise
}
