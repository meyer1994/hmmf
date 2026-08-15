import type {
  Ciphertext,
  MainModule,
  Plaintext,
  PublicKey,
  SEALContext,
  SecretKey
} from 'node-seal'
import type { HEParameterDescriptor } from './he'

interface HEClientOptions {
  seal: MainModule
  parameters: HEParameterDescriptor
}

export class HEClient {
  readonly seal: MainModule
  readonly parameters: HEParameterDescriptor

  private contextValue: SEALContext | null = null

  constructor(options: HEClientOptions) {
    this.seal = options.seal
    this.parameters = options.parameters
  }

  get context(): SEALContext {
    if (!this.contextValue) throw new Error('HE client has not been initialized.')
    return this.contextValue
  }

  init(): this {
    this.dispose()

    const parms = new this.seal.EncryptionParameters(this.seal.SchemeType.bfv)
    const coeffModulus = this.seal.CoeffModulus.Create(
      this.parameters.polyModulusDegree,
      Int32Array.from(this.parameters.coeffModulusBits)
    )
    const plainModulus = this.seal.PlainModulus.Batching(
      this.parameters.polyModulusDegree,
      this.parameters.plainModulusBits
    )

    try {
      parms.setPolyModulusDegree(this.parameters.polyModulusDegree)
      parms.setCoeffModulus(coeffModulus)
      parms.setPlainModulus(plainModulus)

      const context = new this.seal.SEALContext(parms, true, this.seal.SecLevelType.tc128)
      if (!context.parametersSet()) {
        context.delete()
        throw new Error('Microsoft SEAL rejected these encryption parameters.')
      }

      this.contextValue = context
      return this
    } finally {
      plainModulus.delete()
      coeffModulus.delete()
      parms.delete()
    }
  }

  encrypt(value: string, publicKey: PublicKey): Uint8Array {
    const encoder = new this.seal.BatchEncoder(this.context)
    const encryptor = new this.seal.Encryptor(this.context, publicKey)
    const plaintext: Plaintext = new this.seal.Plaintext()
    const ciphertext: Ciphertext = new this.seal.Ciphertext()

    try {
      encoder.encode(BigInt64Array.from([BigInt(value)]), plaintext)
      encryptor.encrypt(plaintext, ciphertext)
      return Uint8Array.from(ciphertext.saveToArray(this.seal.ComprModeType.zlib))
    } finally {
      ciphertext.delete()
      plaintext.delete()
      encryptor.delete()
      encoder.delete()
    }
  }

  decrypt(bytes: Uint8Array, secretKey: SecretKey): bigint {
    const encoder = new this.seal.BatchEncoder(this.context)
    const decryptor = new this.seal.Decryptor(this.context, secretKey)
    const ciphertext = new this.seal.Ciphertext()
    const plaintext = new this.seal.Plaintext()

    try {
      ciphertext.loadFromArray(this.context, bytes)
      decryptor.decrypt(ciphertext, plaintext)
      const values = encoder.decodeBigInt64(plaintext) as BigInt64Array
      const value = values[0]
      if (value === undefined) throw new Error('Decrypted plaintext did not contain a batched value.')
      return value
    } finally {
      plaintext.delete()
      ciphertext.delete()
      decryptor.delete()
      encoder.delete()
    }
  }

  dispose(): void {
    this.contextValue?.delete()
    this.contextValue = null
  }
}
