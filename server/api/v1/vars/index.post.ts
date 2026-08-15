import { getRequestHeader, readRawBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import { HE_HEADERS } from '~~/shared/he'

const headersSchema = z.object({
  scheme: z.literal('BFV'),
  polyModulusDegree: z.coerce.number().pipe(z.union([z.literal(4096), z.literal(8192)])),
  coeffModulusBits: z.string()
    .transform(value => value.split(',').map(Number))
    .pipe(z.array(z.number().int()).nonempty()),
  plainModulusBits: z.coerce.number().int().min(2).max(30)
})

export default defineEventHandler(async (event) => {
  console.log('[vars:upload] request received')

  const parameters = headersSchema.parse({
    scheme: getRequestHeader(event, HE_HEADERS.scheme),
    polyModulusDegree: getRequestHeader(event, HE_HEADERS.polyModulusDegree),
    coeffModulusBits: getRequestHeader(event, HE_HEADERS.coeffModulusBits),
    plainModulusBits: getRequestHeader(event, HE_HEADERS.plainModulusBits)
  })

  const body = await readRawBody(event, false)
  if (!body) throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  const ciphertext = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  console.log('[vars:upload] request validated', {
    byteLength: ciphertext.byteLength,
    parameters
  })

  const id = crypto.randomUUID()

  const storage = useStorage('he')
  await storage.setItemRaw(`vars:${id}:ciphertext.bin`, ciphertext)
  await storage.setMeta(`vars:${id}:ciphertext.bin`, {
    id,
    ...parameters,
    byteLength: ciphertext.byteLength,
    createdAt: new Date().toISOString()
  })
  console.log('[vars:upload] ciphertext stored', { id })

  setResponseStatus(event, 201)
  return { id, scheme: parameters.scheme }
})
