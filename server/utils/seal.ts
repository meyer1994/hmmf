import initializeSEAL from 'node-seal/throws'
import sealWasmModule from '../../node_modules/node-seal/dist/seal_throws.wasm?module'

const sealPromise = initializeSEAL({
  instantiateWasm(
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
  ) {
    const instance = new WebAssembly.Instance(sealWasmModule, imports)
    receiveInstance(instance, sealWasmModule)
    return instance.exports
  }
})

export function getServerSEAL() {
  return sealPromise
}
