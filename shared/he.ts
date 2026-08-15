export const HE_HEADERS = {
  scheme: 'x-he-scheme',
  polyModulusDegree: 'x-he-poly-modulus-degree',
  coeffModulusBits: 'x-he-coeff-modulus-bits',
  plainModulusBits: 'x-he-plain-modulus-bits'
} as const

export interface HEParameterDescriptor {
  scheme: 'BFV'
  polyModulusDegree: 4096 | 8192
  coeffModulusBits: number[]
  plainModulusBits: number
}

export type HERequestDescriptor = HEParameterDescriptor

export interface StoredCiphertextMetadata extends HERequestDescriptor {
  id: string
  byteLength: number
  createdAt: string
}

export interface ObjectReference {
  id: string
  scheme: 'BFV'
}

export interface ExecuteRequest {
  inputs: Record<string, string>
  logic: unknown
}

export interface ExecuteResponse {
  result: {
    id: string
  }
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export function parameterHeaders(descriptor: HEParameterDescriptor): Record<string, string> {
  return {
    [HE_HEADERS.scheme]: descriptor.scheme,
    [HE_HEADERS.polyModulusDegree]: String(descriptor.polyModulusDegree),
    [HE_HEADERS.coeffModulusBits]: descriptor.coeffModulusBits.join(','),
    [HE_HEADERS.plainModulusBits]: String(descriptor.plainModulusBits)
  }
}
