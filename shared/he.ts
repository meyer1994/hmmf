export const HE_HEADERS = {
  scheme: 'x-he-scheme',
  polyModulusDegree: 'x-he-poly-modulus-degree',
  coeffModulusBits: 'x-he-coeff-modulus-bits',
  plainModulusBits: 'x-he-plain-modulus-bits',
  keyFingerprint: 'x-he-key-fingerprint',
  contextFingerprint: 'x-he-context-fingerprint'
} as const

export interface HEParameterDescriptor {
  scheme: 'BFV'
  polyModulusDegree: 4096 | 8192
  coeffModulusBits: number[]
  plainModulusBits: number
}

export interface HERequestDescriptor extends HEParameterDescriptor {
  keyFingerprint: string
}

export interface StoredCiphertextMetadata extends HERequestDescriptor {
  id: string
  contextFingerprint: string
  byteLength: number
  createdAt: string
}

export interface ObjectReference {
  id: string
  scheme: 'BFV'
  contextFingerprint: string
  keyFingerprint: string
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

export function canonicalizeParameters(descriptor: HEParameterDescriptor): string {
  return [
    descriptor.scheme,
    descriptor.polyModulusDegree,
    descriptor.coeffModulusBits.join(','),
    descriptor.plainModulusBits
  ].join('|')
}

export async function sha256Fingerprint(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export function parameterHeaders(descriptor: HERequestDescriptor): Record<string, string> {
  return {
    [HE_HEADERS.scheme]: descriptor.scheme,
    [HE_HEADERS.polyModulusDegree]: String(descriptor.polyModulusDegree),
    [HE_HEADERS.coeffModulusBits]: descriptor.coeffModulusBits.join(','),
    [HE_HEADERS.plainModulusBits]: String(descriptor.plainModulusBits),
    [HE_HEADERS.keyFingerprint]: descriptor.keyFingerprint
  }
}
