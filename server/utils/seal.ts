import SEAL from 'node-seal/throws_wasm_cf_worker_es'
import sealWasmModule from 'node-seal/seal_throws_wasm_cf_worker.wasm?module'

type Seal = Awaited<ReturnType<typeof SEAL>>

let instance: Promise<Seal> | undefined

export const getSeal = async (): Promise<Seal> => {
  if (!instance) {
    instance = SEAL(sealWasmModule)
  }

  return instance
}
