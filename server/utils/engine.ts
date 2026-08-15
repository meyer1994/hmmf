import jsonLogic from 'json-logic-js'
import type { CipherText } from 'node-seal/implementation/cipher-text'
import type { Context } from 'node-seal/implementation/context'
import type { Evaluator } from 'node-seal/implementation/evaluator'
import type { RelinKeys } from 'node-seal/implementation/relin-keys'
import type { HEParameterDescriptor } from '~~/shared/he'
import type { getSeal } from './seal'

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

/**
 * A value in the encrypted domain.
 *
 * It is done this way, because they need a referenec to the engine to perform
 * operations. This was done to make this interoperable with json-logic-js.
 *
 * @property {HEEngine} engine - The engine that created this value.
 * @property {CipherText} cypher - The ciphertext representing this value.
 */
interface Value {
  engine: HEEngine
  cypher: CipherText
}

jsonLogic.add_operation('he_add', (left: Value, right: Value) => left.engine.add(left, right))
jsonLogic.add_operation('he_sub', (left: Value, right: Value) => left.engine.sub(left, right))
jsonLogic.add_operation('he_mul', (left: Value, right: Value) => left.engine.multiply(left, right))

export class HEEngine {
  private readonly seal: Awaited<ReturnType<typeof getSeal>>
  private readonly context: Context
  private readonly evaluator: Evaluator
  private readonly ciphertexts = new Set<CipherText>()
  private relinKeys: RelinKeys | null = null

  constructor(seal: Awaited<ReturnType<typeof getSeal>>, props: HEParameterDescriptor) {
    this.seal = seal

    const parms = seal.EncryptionParameters(seal.SchemeType.bfv)

    const coeffModulus = seal.CoeffModulus.Create(
      props.polyModulusDegree,
      Int32Array.from(props.coeffModulusBits)
    )

    const plainModulus = seal.PlainModulus.Batching(
      props.polyModulusDegree,
      props.plainModulusBits
    )

    parms.setPolyModulusDegree(props.polyModulusDegree)
    parms.setCoeffModulus(coeffModulus)
    parms.setPlainModulus(plainModulus)
    this.context = seal.Context(parms, true, seal.SecurityLevel.tc128)
    this.evaluator = seal.Evaluator(this.context)

    plainModulus.delete()
    coeffModulus.delete()
    parms.delete()
  }

  load(bytes: Uint8Array): Value {
    const ciphertext = this.seal.CipherText()
    ciphertext.loadArray(this.context, Uint8Array.from(bytes))
    this.ciphertexts.add(ciphertext)
    return { engine: this, cypher: ciphertext }
  }

  loadRelinKeys(bytes: Uint8Array): void {
    this.relinKeys = this.seal.RelinKeys()
    this.relinKeys.loadArray(this.context, Uint8Array.from(bytes))
  }

  evaluate(logic: Logic, data: Record<string, Value>): Uint8Array {
    const result = jsonLogic.apply(compile(logic) as never, data) as Value
    return new Uint8Array(result.cypher.saveArray(this.seal.ComprModeType.zlib))
  }

  dispose(): void {
    this.relinKeys?.delete()
    for (const ciphertext of this.ciphertexts) ciphertext.delete()
    this.evaluator.delete()
    this.context.delete()
  }

  add(left: Value, right: Value): Value {
    return this.calculate(result => this.evaluator.add(left.cypher, right.cypher, result))
  }

  sub(left: Value, right: Value): Value {
    return this.calculate(result => this.evaluator.sub(left.cypher, right.cypher, result))
  }

  multiply(left: Value, right: Value): Value {
    return this.calculate((result) => {
      this.evaluator.multiply(left.cypher, right.cypher, result)
      this.evaluator.relinearize(result, this.relinKeys!, result)
    })
  }

  private calculate(operation: (result: CipherText) => void): Value {
    const ciphertext = this.seal.CipherText()
    operation(ciphertext)
    this.ciphertexts.add(ciphertext)
    return { engine: this, cypher: ciphertext }
  }
}

function compile(logic: Logic): CompiledLogic {
  if ('var' in logic) return logic
  if ('+' in logic) return { he_add: logic['+'].map(compile) as [CompiledLogic, CompiledLogic] }
  if ('-' in logic) return { he_sub: logic['-'].map(compile) as [CompiledLogic, CompiledLogic] }
  return { he_mul: logic['*'].map(compile) as [CompiledLogic, CompiledLogic] }
}
