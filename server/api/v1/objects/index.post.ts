import { getRequestHeader, readRawBody, setResponseStatus } from 'h3'
import { z } from 'zod'
import {
  HE_HEADERS,
  canonicalizeParameters,
  sha256Fingerprint,
  type StoredCiphertextMetadata
} from '~~/shared/he'

const headersSchema = z.object({
  scheme: z.literal('BFV'),
  polyModulusDegree: z.coerce.number().pipe(z.union([z.literal(4096), z.literal(8192)])),
  coeffModulusBits: z.string()
    .transform(value => value.split(',').map(Number))
    .pipe(z.array(z.number().int()).nonempty()),
  plainModulusBits: z.coerce.number().int().min(2).max(30),
  keyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/)
})

export default defineEventHandler(async (event) => {
  const parameters = headersSchema.parse({
    scheme: getRequestHeader(event, HE_HEADERS.scheme),
    polyModulusDegree: getRequestHeader(event, HE_HEADERS.polyModulusDegree),
    coeffModulusBits: getRequestHeader(event, HE_HEADERS.coeffModulusBits),
    plainModulusBits: getRequestHeader(event, HE_HEADERS.plainModulusBits),
    keyFingerprint: getRequestHeader(event, HE_HEADERS.keyFingerprint)
  })

  const body = await readRawBody(event, false)
  if (!body) throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  const ciphertext = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

  const id = crypto.randomUUID()
  const contextFingerprint = await sha256Fingerprint(canonicalizeParameters(parameters))

  const storage = useStorage('he')
  await storage.setItemRaw(`objects:${id}:ciphertext.bin`, ciphertext)
  await storage.setItem(`objects:${id}:metadata.json`, {
    id,
    ...parameters,
    contextFingerprint,
    byteLength: ciphertext.byteLength,
    createdAt: new Date().toISOString()
  })

  setResponseStatus(event, 201)
  return {
    id,
    scheme: parameters.scheme,
    contextFingerprint,
    keyFingerprint: parameters.keyFingerprint
  }
})
