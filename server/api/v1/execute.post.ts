import { getRequestHeader, readBody, setResponseStatus } from 'h3'
import initializeSEAL from 'node-seal/throws'
import { z } from 'zod'
import sealWasmModule from '../../../node_modules/node-seal/dist/seal_throws.wasm?module'
import {
  HE_HEADERS,
  canonicalizeParameters,
  sha256Fingerprint,
  type StoredCiphertextMetadata
} from '~~/shared/he'
import { HEEngine, type Logic } from '~~/server/utils/he-engine'

const headersSchema = z.object({
  scheme: z.literal('BFV'),
  polyModulusDegree: z.coerce.number().pipe(z.union([z.literal(4096), z.literal(8192)])),
  coeffModulusBits: z.string()
    .transform(value => value.split(',').map(Number))
    .pipe(z.array(z.number().int()).nonempty()),
  plainModulusBits: z.coerce.number().int().min(2).max(30),
  keyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/)
})

const logicSchema: z.ZodType<Logic> = z.lazy(() => z.union([
  z.object({ var: z.string() }).strict(),
  z.object({ '+': z.tuple([logicSchema, logicSchema]) }).strict(),
  z.object({ '-': z.tuple([logicSchema, logicSchema]) }).strict(),
  z.object({ '*': z.tuple([logicSchema, logicSchema]) }).strict()
]))

const executeSchema = z.object({
  inputs: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.uuid()),
  logic: logicSchema,
  relinKeys: z.string().optional()
})

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

export default defineEventHandler(async (event) => {
  const parameters = headersSchema.parse({
    scheme: getRequestHeader(event, HE_HEADERS.scheme),
    polyModulusDegree: getRequestHeader(event, HE_HEADERS.polyModulusDegree),
    coeffModulusBits: getRequestHeader(event, HE_HEADERS.coeffModulusBits),
    plainModulusBits: getRequestHeader(event, HE_HEADERS.plainModulusBits),
    keyFingerprint: getRequestHeader(event, HE_HEADERS.keyFingerprint)
  })

  const request = await readValidatedBody(event, executeSchema.parse)

  const engine = new HEEngine(await sealPromise, parameters)
  try {
    if (request.relinKeys) engine.loadRelinKeys(decodeBase64(request.relinKeys))

    const storage = useStorage('he')
    const entries = await Promise.all(Object.entries(request.inputs).map(async ([name, id]) => {
      const bytes = (await storage.getItemRaw(`objects:${id}:ciphertext.bin`, { type: 'bytes' })) as Uint8Array
      return [name, engine.load(bytes)] as const
    }))

    const id = crypto.randomUUID()
    const resultBytes = engine.evaluate(request.logic, Object.fromEntries(entries))
    const contextFingerprint = await sha256Fingerprint(canonicalizeParameters(parameters))

    await storage.setItemRaw(`objects:${id}:ciphertext.bin`, resultBytes)
    await storage.setItem(`objects:${id}:metadata.json`, {
      id,
      ...parameters,
      contextFingerprint,
      byteLength: resultBytes.byteLength,
      createdAt: new Date().toISOString()
    })

    setResponseStatus(event, 201)
    return { result: { id } }
  } finally {
    engine.dispose()
  }
})

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}
