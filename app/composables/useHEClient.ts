import type {
  BatchEncoder,
  Ciphertext,
  Decryptor,
  Encryptor,
  KeyGenerator,
  MainModule,
  Plaintext,
  PublicKey,
  RelinKeys,
  SEALContext,
  SecretKey
} from 'node-seal'
import sealWasmUrl from '../../node_modules/node-seal/dist/seal_throws.wasm?url'
import {
  HE_HEADERS,
  canonicalizeParameters,
  parameterHeaders,
  sha256Fingerprint,
  type ApiErrorBody,
  type ExecuteRequest,
  type ExecuteResponse,
  type HEParameterDescriptor,
  type HERequestDescriptor,
  type ObjectReference
} from '~~/shared/he'

interface ClientSession {
  createdAt: string
  seal: MainModule
  context: SEALContext
  keyGenerator: KeyGenerator
  secretKey: SecretKey
  publicKey: PublicKey
  relinKeys: RelinKeys
  encoder: BatchEncoder
  encryptor: Encryptor
  decryptor: Decryptor
  descriptor: HERequestDescriptor
  contextFingerprint: string
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

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as ApiErrorBody
    if (body.error?.message) {
      return new Error(body.error.message)
    }
  } catch {
    // Fall back to the HTTP status below.
  }
  return new Error(`Request failed with HTTP ${response.status}.`)
}

export function useHEClient() {
  let session: ClientSession | null = null

  function dispose(): void {
    if (!session) {
      return
    }
    session.decryptor.delete()
    session.encryptor.delete()
    session.encoder.delete()
    session.relinKeys.delete()
    session.publicKey.delete()
    session.secretKey.delete()
    session.keyGenerator.delete()
    session.context.delete()
    session = null
  }

  function requireSession(): ClientSession {
    if (!session) {
      throw new Error('Generate a key session first.')
    }
    return session
  }

  async function initialize(parameters: HEParameterDescriptor): Promise<{
    descriptor: HERequestDescriptor
    contextFingerprint: string
  }> {
    dispose()
    const { default: initializeSEAL } = await import('node-seal/throws')
    const seal = await initializeSEAL({
      locateFile: path => path.endsWith('.wasm') ? sealWasmUrl : path
    })
    const parms = new seal.EncryptionParameters(seal.SchemeType.bfv)
    const coeffModulus = seal.CoeffModulus.Create(
      parameters.polyModulusDegree,
      Int32Array.from(parameters.coeffModulusBits)
    )
    const plainModulus = seal.PlainModulus.Batching(parameters.polyModulusDegree, parameters.plainModulusBits)

    try {
      parms.setPolyModulusDegree(parameters.polyModulusDegree)
      parms.setCoeffModulus(coeffModulus)
      parms.setPlainModulus(plainModulus)

      const context = new seal.SEALContext(parms, true, seal.SecLevelType.tc128)
      if (!context.parametersSet()) {
        context.delete()
        throw new Error('Microsoft SEAL rejected these encryption parameters.')
      }

      const keyGenerator = new seal.KeyGenerator(context)
      const secretKey = keyGenerator.secretKey()
      const publicKey = keyGenerator.createPublicKey()
      const relinKeys = keyGenerator.createRelinKeys()
      const publicKeyBytes = bytesFrom(publicKey.saveToArray(seal.ComprModeType.zlib))
      const keyFingerprint = await sha256Fingerprint(publicKeyBytes)
      const descriptor: HERequestDescriptor = { ...parameters, keyFingerprint }

      session = {
        createdAt: new Date().toISOString(),
        seal,
        context,
        keyGenerator,
        secretKey,
        publicKey,
        relinKeys,
        encoder: new seal.BatchEncoder(context),
        encryptor: new seal.Encryptor(context, publicKey),
        decryptor: new seal.Decryptor(context, secretKey),
        descriptor,
        contextFingerprint: await sha256Fingerprint(canonicalizeParameters(parameters))
      }
      return {
        descriptor: session.descriptor,
        contextFingerprint: session.contextFingerprint
      }
    } finally {
      plainModulus.delete()
      coeffModulus.delete()
      parms.delete()
    }
  }

  function encrypt(value: string): Uint8Array {
    const active = requireSession()
    const plaintext: Plaintext = new active.seal.Plaintext()
    const ciphertext: Ciphertext = new active.seal.Ciphertext()
    try {
      active.encoder.encode(BigInt64Array.from([BigInt(value)]), plaintext)
      active.encryptor.encrypt(plaintext, ciphertext)
      return bytesFrom(ciphertext.saveToArray(active.seal.ComprModeType.zlib))
    } finally {
      ciphertext.delete()
      plaintext.delete()
    }
  }

  async function upload(value: string): Promise<ObjectReference> {
    const active = requireSession()
    const ciphertext = encrypt(value)
    const response = await fetch('/api/v1/objects', {
      method: 'POST',
      headers: {
        ...parameterHeaders(active.descriptor),
        'content-type': 'application/octet-stream'
      },
      body: exactArrayBuffer(ciphertext)
    })
    if (!response.ok) {
      throw await responseError(response)
    }
    return await response.json() as ObjectReference
  }

  async function execute(request: ExecuteRequest): Promise<string> {
    const active = requireSession()
    const requiresRelinKeys = JSON.stringify(request.logic).includes('"*"')
    const relinKeys = requiresRelinKeys
      ? encodeBase64(bytesFrom(active.relinKeys.saveToArray(active.seal.ComprModeType.zlib)))
      : undefined

    const response = await fetch('/api/v1/execute', {
      method: 'POST',
      headers: {
        ...parameterHeaders(active.descriptor),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ...request, relinKeys })
    })
    if (!response.ok) {
      throw await responseError(response)
    }
    const body = await response.json() as ExecuteResponse
    return body.result.id
  }

  async function downloadAndDecrypt(id: string): Promise<bigint> {
    const active = requireSession()
    const response = await fetch(`/api/v1/objects/${encodeURIComponent(id)}`)
    if (!response.ok) {
      throw await responseError(response)
    }
    if (
      response.headers.get(HE_HEADERS.keyFingerprint) !== active.descriptor.keyFingerprint
      || response.headers.get(HE_HEADERS.contextFingerprint) !== active.contextFingerprint
    ) {
      throw new Error('Downloaded ciphertext does not belong to the active key session and context.')
    }

    const ciphertext = new active.seal.Ciphertext()
    const plaintext = new active.seal.Plaintext()
    try {
      ciphertext.loadFromArray(active.context, new Uint8Array(await response.arrayBuffer()))
      active.decryptor.decrypt(ciphertext, plaintext)
      const values = active.encoder.decodeBigInt64(plaintext) as BigInt64Array
      const value = values[0]
      if (value === undefined) {
        throw new Error('Decrypted plaintext did not contain a batched value.')
      }
      return value
    } finally {
      plaintext.delete()
      ciphertext.delete()
    }
  }

  function getDebugSession() {
    if (!session) {
      return null
    }

    const secretKey = bytesFrom(session.secretKey.saveToArray(session.seal.ComprModeType.zlib))
    const publicKey = bytesFrom(session.publicKey.saveToArray(session.seal.ComprModeType.zlib))
    const relinKeys = bytesFrom(session.relinKeys.saveToArray(session.seal.ComprModeType.zlib))

    return {
      createdAt: session.createdAt,
      descriptor: session.descriptor,
      contextFingerprint: session.contextFingerprint,
      keys: {
        secret: { byteLength: secretKey.byteLength, base64: encodeBase64(secretKey) },
        public: { byteLength: publicKey.byteLength, base64: encodeBase64(publicKey) },
        relinearization: { byteLength: relinKeys.byteLength, base64: encodeBase64(relinKeys) }
      }
    }
  }

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
