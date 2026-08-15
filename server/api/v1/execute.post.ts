import { getRequestHeader, setResponseStatus } from 'h3'
import { z } from 'zod'
import { HEEngine, type Logic } from '~~/server/utils/engine'

import { getSeal } from '~~/server/utils/seal'
import { HE_HEADERS } from '~~/shared/he'

const headersSchema = z.object({
  scheme: z.literal('BFV'),
  polyModulusDegree: z.coerce.number().pipe(z.union([z.literal(4096), z.literal(8192)])),
  coeffModulusBits: z.string()
    .transform(value => value.split(',').map(Number))
    .pipe(z.array(z.number().int()).nonempty()),
  plainModulusBits: z.coerce.number().int().min(2).max(30)
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

export default defineEventHandler(async (event) => {
  let engine: HEEngine | undefined

  try {
    const parameters = headersSchema.parse({
      scheme: getRequestHeader(event, HE_HEADERS.scheme),
      polyModulusDegree: getRequestHeader(event, HE_HEADERS.polyModulusDegree),
      coeffModulusBits: getRequestHeader(event, HE_HEADERS.coeffModulusBits),
      plainModulusBits: getRequestHeader(event, HE_HEADERS.plainModulusBits)
    })

    const request = await readValidatedBody(event, executeSchema.parse)
    console.log('[execute] request received', {
      parameters,
      inputCount: Object.keys(request.inputs).length,
      hasRelinKeys: Boolean(request.relinKeys)
    })

    engine = new HEEngine(await getSeal(), parameters)
    if (request.relinKeys) engine.loadRelinKeys(decodeBase64(request.relinKeys))

    const storage = useStorage('he')
    const entries = await Promise.all(Object.entries(request.inputs).map(async ([name, id]) => {
      const bytes = (await storage.getItemRaw(`vars:${id}:ciphertext.bin`, { type: 'bytes' })) as Uint8Array
      return [name, engine!.load(bytes)] as const
    }))
    console.log('[execute] inputs loaded', { count: entries.length })

    const id = crypto.randomUUID()
    const resultBytes = engine.evaluate(request.logic, Object.fromEntries(entries))
    console.log('[execute] expression evaluated', { id, byteLength: resultBytes.byteLength })

    await storage.setItemRaw(`vars:${id}:ciphertext.bin`, resultBytes)
    await storage.setMeta(`vars:${id}:ciphertext.bin`, {
      id,
      ...parameters,
      byteLength: resultBytes.byteLength,
      createdAt: new Date().toISOString()
    })

    console.log('[execute] result stored', { id })
    setResponseStatus(event, 201)
    return { result: { id } }
  } catch (error) {
    console.log('[execute] request failed', error)
    throw error
  } finally {
    engine?.dispose()
  }
})

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}
