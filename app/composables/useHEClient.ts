import type { KeyGenerator } from 'node-seal/implementation/key-generator'
import type { PublicKey } from 'node-seal/implementation/public-key'
import type { RelinKeys } from 'node-seal/implementation/relin-keys'
import type { SecretKey } from 'node-seal/implementation/secret-key'
import type { SEALLibrary } from 'node-seal/implementation/seal'
import SEAL from 'node-seal/throws_wasm_web_es'

import {
  parameterHeaders,
  type ExecuteRequest,
  type ExecuteResponse,
  type HEParameterDescriptor,
  type HERequestDescriptor,
  type ObjectReference
} from '~~/shared/he'
import { HEClient } from '~~/shared/he-client'

const sealPromise = SEAL()

interface ClientSession {
  createdAt: string
  seal: SEALLibrary
  client: HEClient
  keyGenerator: KeyGenerator
  secretKey: SecretKey
  publicKey: PublicKey
  relinKeys: RelinKeys
  descriptor: HERequestDescriptor
}

function bytesFrom(value: ArrayLike<number>): Uint8Array {
  return Uint8Array.from(value)
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  }
  return btoa(chunks.join(''))
}

export function useHEClient() {
  let session: ClientSession | null = null

  function dispose(): void {
    session?.relinKeys.delete()
    session?.publicKey.delete()
    session?.secretKey.delete()
    session?.keyGenerator.delete()
    session?.client.dispose()
    session = null
  }

  function requireSession(): ClientSession {
    if (!session) throw new Error('Generate a key session first.')
    return session
  }

  async function initialize(parameters: HEParameterDescriptor): Promise<{
    descriptor: HERequestDescriptor
  }> {
    dispose()
    const seal = await sealPromise
    const client = new HEClient({ seal, parameters }).init()
    const keyGenerator = seal.KeyGenerator(client.context)
    const secretKey = keyGenerator.secretKey()
    const publicKey = keyGenerator.createPublicKey()
    const relinKeys = keyGenerator.createRelinKeys()
    const descriptor: HERequestDescriptor = { ...parameters }

    session = {
      createdAt: new Date().toISOString(),
      seal,
      client,
      keyGenerator,
      secretKey,
      publicKey,
      relinKeys,
      descriptor
    }

    return { descriptor }
  }

  function encrypt(value: string): Uint8Array {
    const active = requireSession()
    return active.client.encrypt(value, active.publicKey)
  }

  async function upload(value: string): Promise<ObjectReference> {
    const active = requireSession()
    const ciphertext = encrypt(value)
    return await $fetch<ObjectReference>('/api/v1/vars', {
      method: 'POST',
      headers: {
        ...parameterHeaders(active.descriptor),
        'content-type': 'application/octet-stream'
      },
      body: exactArrayBuffer(ciphertext)
    })
  }

  async function execute(request: ExecuteRequest): Promise<string> {
    const active = requireSession()
    const relinKeys = encodeBase64(
      bytesFrom(active.relinKeys.saveArray(active.seal.ComprModeType.zlib))
    )

    const body = await $fetch<ExecuteResponse>('/api/v1/execute', {
      method: 'POST',
      headers: {
        ...parameterHeaders(active.descriptor),
        'content-type': 'application/json'
      },
      body: { ...request, relinKeys }
    })
    return body.result.id
  }

  async function downloadAndDecrypt(id: string): Promise<bigint> {
    const active = requireSession()
    const response = await $fetch.raw<ArrayBuffer>(`/api/v1/vars/${encodeURIComponent(id)}`, {
      responseType: 'arrayBuffer'
    })

    return active.client.decrypt(new Uint8Array(response._data!), active.secretKey)
  }

  function getDebugSession() {
    if (!session) return null

    const secretKey = bytesFrom(session.secretKey.saveArray(session.seal.ComprModeType.zlib))
    const publicKey = bytesFrom(session.publicKey.saveArray(session.seal.ComprModeType.zlib))
    const relinKeys = bytesFrom(session.relinKeys.saveArray(session.seal.ComprModeType.zlib))

    return {
      createdAt: session.createdAt,
      descriptor: session.descriptor,
      keys: {
        secret: { byteLength: secretKey.byteLength, base64: encodeBase64(secretKey) },
        public: { byteLength: publicKey.byteLength, base64: encodeBase64(publicKey) },
        relinearization: { byteLength: relinKeys.byteLength, base64: encodeBase64(relinKeys) }
      }
    }
  }

  onUnmounted(dispose)
  onScopeDispose(dispose)

  return {
    initialize,
    dispose,
    upload,
    execute,
    downloadAndDecrypt,
    getDebugSession
  }
}
