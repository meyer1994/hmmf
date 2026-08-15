import { z } from 'zod'
import { HE_HEADERS, type StoredCiphertextMetadata } from '~~/shared/he'

const paramsSchema = z.object({ id: z.uuid() })

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)

  const storage = useStorage('he')
  const metadata = (await storage.getItem(`objects:${id}:metadata.json`)) as StoredCiphertextMetadata
  const ciphertext = (await storage.getItemRaw(`objects:${id}:ciphertext.bin`, { type: 'bytes' })) as Uint8Array

  const body = new Uint8Array(ciphertext.byteLength)
  body.set(ciphertext)

  return new Response(body.buffer, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': 'private, no-store',
      [HE_HEADERS.scheme]: metadata.scheme,
      [HE_HEADERS.polyModulusDegree]: String(metadata.polyModulusDegree),
      [HE_HEADERS.coeffModulusBits]: metadata.coeffModulusBits.join(','),
      [HE_HEADERS.plainModulusBits]: String(metadata.plainModulusBits)
    }
  })
})
