import SEAL from 'node-seal/throws'

type Seal = Awaited<ReturnType<typeof SEAL>>

let instance: Promise<Seal> | undefined

export const getSeal = async (): Promise<Seal> => {
  if (!instance) instance = SEAL()
  return instance
}
