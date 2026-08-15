import jsonLogic from 'json-logic-js'
import type { Ciphertext, Evaluator, MainModule, RelinKeys, SEALContext } from 'node-seal'
import type { HEParameterDescriptor } from '~~/shared/he'

export type Logic
  = | { var: string }
    | { '+': [Logic, Logic] }
    | { '-': [Logic, Logic] }
    | { '*': [Logic, Logic] }

type CompiledLogic
  = | { var: string }
    | { he_add: [CompiledLogic, CompiledLogic] }
    | { he_sub: [CompiledLogic, CompiledLogic] }
    | { he_mul: [CompiledLogic, CompiledLogic] }

interface EncryptedValue {
  engine: HEEngine
  ciphertext: Ciphertext
}

jsonLogic.add_operation('he_add', (left: EncryptedValue, right: EncryptedValue) => left.engine.add(left, right))
jsonLogic.add_operation('he_sub', (left: EncryptedValue, right: EncryptedValue) => left.engine.sub(left, right))
jsonLogic.add_operation('he_mul', (left: EncryptedValue, right: EncryptedValue) => left.engine.multiply(left, right))

export class HEEngine {
  private readonly context: SEALContext
  private readonly evaluator: Evaluator
  private readonly ciphertexts = new Set<Ciphertext>()
  private relinKeys: RelinKeys | null = null

  constructor(
    private readonly seal: MainModule,
    parameters: HEParameterDescriptor
  ) {
    const parms = new seal.EncryptionParameters(seal.SchemeType.bfv)
    const coeffModulus = seal.CoeffModulus.Create(
      parameters.polyModulusDegree,
      Int32Array.from(parameters.coeffModulusBits)
    )
    const plainModulus = seal.PlainModulus.Batching(
      parameters.polyModulusDegree,
      parameters.plainModulusBits
    )

    parms.setPolyModulusDegree(parameters.polyModulusDegree)
    parms.setCoeffModulus(coeffModulus)
    parms.setPlainModulus(plainModulus)
    this.context = new seal.SEALContext(parms, true, seal.SecLevelType.tc128)
    this.evaluator = new seal.Evaluator(this.context)

    plainModulus.delete()
    coeffModulus.delete()
    parms.delete()
  }

  load(bytes: Uint8Array): EncryptedValue {
    const ciphertext = new this.seal.Ciphertext()
    ciphertext.loadFromArray(this.context, Uint8Array.from(bytes))
    this.ciphertexts.add(ciphertext)
    return { engine: this, ciphertext }
  }

  loadRelinKeys(bytes: Uint8Array): void {
    this.relinKeys = new this.seal.RelinKeys()
    this.relinKeys.loadFromArray(this.context, Uint8Array.from(bytes))
  }

  evaluate(logic: Logic, data: Record<string, EncryptedValue>): Uint8Array {
    const result = jsonLogic.apply(compile(logic) as never, data) as EncryptedValue
    return new Uint8Array(result.ciphertext.saveToArray(this.seal.ComprModeType.zlib))
  }

  dispose(): void {
    this.relinKeys?.delete()
    for (const ciphertext of this.ciphertexts) {
      ciphertext.delete()
    }
    this.evaluator.delete()
    this.context.delete()
  }

  add(left: EncryptedValue, right: EncryptedValue): EncryptedValue {
    return this.calculate(result => this.evaluator.add(left.ciphertext, right.ciphertext, result))
  }

  sub(left: EncryptedValue, right: EncryptedValue): EncryptedValue {
    return this.calculate(result => this.evaluator.sub(left.ciphertext, right.ciphertext, result))
  }

  multiply(left: EncryptedValue, right: EncryptedValue): EncryptedValue {
    return this.calculate((result) => {
      this.evaluator.multiply(left.ciphertext, right.ciphertext, result)
      this.evaluator.relinearizeInplace(result, this.relinKeys!)
    })
  }

  private calculate(operation: (result: Ciphertext) => void): EncryptedValue {
    const ciphertext = new this.seal.Ciphertext()
    operation(ciphertext)
    this.ciphertexts.add(ciphertext)
    return { engine: this, ciphertext }
  }
}

function compile(logic: Logic): CompiledLogic {
  if ('var' in logic) return logic
  if ('+' in logic) return { he_add: logic['+'].map(compile) as [CompiledLogic, CompiledLogic] }
  if ('-' in logic) return { he_sub: logic['-'].map(compile) as [CompiledLogic, CompiledLogic] }
  return { he_mul: logic['*'].map(compile) as [CompiledLogic, CompiledLogic] }
}
