import type { CipherText } from 'node-seal/implementation/cipher-text'
import type { Context } from 'node-seal/implementation/context'
import type { PlainText } from 'node-seal/implementation/plain-text'
import type { PublicKey } from 'node-seal/implementation/public-key'
import type { SecretKey } from 'node-seal/implementation/secret-key'
import type { SEALLibrary } from 'node-seal/implementation/seal'
import type { HEParameterDescriptor } from './he'

interface HEClientOptions {
  seal: SEALLibrary
  parameters: HEParameterDescriptor
}

export class HEClient {
  readonly seal: SEALLibrary
  readonly parameters: HEParameterDescriptor

  private contextValue: Context | null = null

  constructor(options: HEClientOptions) {
    this.seal = options.seal
    this.parameters = options.parameters
  }

  get context(): Context {
    if (!this.contextValue) throw new Error('HE client has not been initialized.')
    return this.contextValue
  }

  init(): this {
    this.dispose()

    const parms = this.seal.EncryptionParameters(this.seal.SchemeType.bfv)
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

      const context = this.seal.Context(parms, true, this.seal.SecurityLevel.tc128)
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
    const encoder = this.seal.BatchEncoder(this.context)
    const encryptor = this.seal.Encryptor(this.context, publicKey)
    const plaintext: PlainText = this.seal.PlainText()
    const ciphertext: CipherText = this.seal.CipherText()

    try {
      encoder.encode(BigInt64Array.from([BigInt(value)]), plaintext)
      encryptor.encrypt(plaintext, ciphertext)
      return Uint8Array.from(ciphertext.saveArray(this.seal.ComprModeType.zlib))
    } finally {
      ciphertext.delete()
      plaintext.delete()
      encryptor.delete()
      encoder.delete()
    }
  }

  decrypt(bytes: Uint8Array, secretKey: SecretKey): bigint {
    const encoder = this.seal.BatchEncoder(this.context)
    const decryptor = this.seal.Decryptor(this.context, secretKey)
    const ciphertext = this.seal.CipherText()
    const plaintext = this.seal.PlainText()

    try {
      ciphertext.loadArray(this.context, bytes)
      decryptor.decrypt(ciphertext, plaintext)
      const values = encoder.decodeBigInt(plaintext) as BigInt64Array
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
