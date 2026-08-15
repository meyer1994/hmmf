import jsonLogic from 'json-logic-js'
import type { Ciphertext, Evaluator, RelinKeys, SEALContext } from 'node-seal'
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
 * @property {Ciphertext} cypher - The ciphertext representing this value.
 */
interface Value {
  engine: HEEngine
  cypher: Ciphertext
}

jsonLogic.add_operation('he_add', (left: Value, right: Value) => left.engine.add(left, right))
jsonLogic.add_operation('he_sub', (left: Value, right: Value) => left.engine.sub(left, right))
jsonLogic.add_operation('he_mul', (left: Value, right: Value) => left.engine.multiply(left, right))

export class HEEngine {
  private readonly seal: Awaited<ReturnType<typeof getSeal>>
  private readonly context: SEALContext
  private readonly evaluator: Evaluator
  private readonly ciphertexts = new Set<Ciphertext>()
  private relinKeys: RelinKeys | null = null

  constructor(seal: Awaited<ReturnType<typeof getSeal>>, props: HEParameterDescriptor) {
    this.seal = seal

    const parms = new seal.EncryptionParameters(seal.SchemeType.bfv)

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
    this.context = new seal.SEALContext(parms, true, seal.SecLevelType.tc128)
    this.evaluator = new seal.Evaluator(this.context)

    plainModulus.delete()
    coeffModulus.delete()
    parms.delete()
  }

  load(bytes: Uint8Array): Value {
    const ciphertext = new this.seal.Ciphertext()
    ciphertext.loadFromArray(this.context, Uint8Array.from(bytes))
    this.ciphertexts.add(ciphertext)
    return { engine: this, cypher: ciphertext }
  }

  loadRelinKeys(bytes: Uint8Array): void {
    this.relinKeys = new this.seal.RelinKeys()
    this.relinKeys.loadFromArray(this.context, Uint8Array.from(bytes))
  }

  evaluate(logic: Logic, data: Record<string, Value>): Uint8Array {
    const result = jsonLogic.apply(compile(logic) as never, data) as Value
    return new Uint8Array(result.cypher.saveToArray(this.seal.ComprModeType.zlib))
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
      this.evaluator.relinearizeInplace(result, this.relinKeys!)
    })
  }

  private calculate(operation: (result: Ciphertext) => void): Value {
    const ciphertext = new this.seal.Ciphertext()
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
