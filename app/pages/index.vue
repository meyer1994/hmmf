<script setup lang="ts">
import type { ExecuteRequest, HEParameterDescriptor } from '~~/shared/he'

useSeoMeta({
  title: 'HMMF · Homomorphic compute playground',
  description: 'Encrypt integers locally and evaluate JSON Logic over ciphertexts without sharing the secret key.'
})

interface PlaygroundInput {
  name: string
  value: string
  objectId: string
}

const he = useHEClient()
const degree = ref<4096 | 8192>(4096)
const coeffBits = ref('36,36,37')
const plainBits = ref(20)
const inputs = ref<PlaygroundInput[]>([
  { name: 'a', value: '10', objectId: '' },
  { name: 'b', value: '17', objectId: '' }
])
const expression = ref(JSON.stringify({ '*': [{ var: 'a' }, { var: 'b' }] }, null, 2))
const keyFingerprint = ref('')
const contextFingerprint = ref('')
const resultId = ref('')
const decryptedResult = ref('')
const status = ref('No active key session.')
const errorMessage = ref('')
const manualBusy = ref(false)
const debugSession = shallowRef<ReturnType<typeof he.getDebugSession>>(null)
const requestedParameters = shallowRef<HEParameterDescriptor | null>(null)
const requestedExecution = shallowRef<ExecuteRequest | null>(null)

const {
  data: sessionData,
  error: sessionError,
  status: sessionRequestStatus,
  execute: initializeSession,
  clear: clearSessionData
} = await useAsyncData('he-session', async () => {
  if (!requestedParameters.value) throw new Error('Encryption parameters are required.')
  return he.initialize(requestedParameters.value)
}, { immediate: false, server: false })

const {
  data: executionData,
  error: executionError,
  status: executionRequestStatus,
  execute: runExecution,
  clear: clearExecutionData
} = await useAsyncData('he-execution', async () => {
  if (!requestedExecution.value) throw new Error('An execution request is required.')
  const id = await he.execute(requestedExecution.value)
  return {
    id,
    decrypted: String(await he.downloadAndDecrypt(id))
  }
}, { immediate: false, server: false })

clearSessionData()
clearExecutionData()

const busy = computed(() => manualBusy.value
  || sessionRequestStatus.value === 'pending'
  || executionRequestStatus.value === 'pending')

function parameters(): HEParameterDescriptor {
  return {
    scheme: 'BFV',
    polyModulusDegree: degree.value,
    coeffModulusBits: coeffBits.value.split(',').map(value => Number(value.trim())),
    plainModulusBits: Number(plainBits.value)
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    const message = error.message
    return Array.isArray(message) ? message.join(': ') : String(message)
  }
  return String(error)
}

async function runAction(action: () => Promise<void>): Promise<void> {
  manualBusy.value = true
  errorMessage.value = ''
  try {
    await action()
  } catch (error) {
    errorMessage.value = formatError(error)
    status.value = 'Action failed.'
  } finally {
    manualBusy.value = false
  }
}

async function generateSession(): Promise<void> {
  await runAction(async () => {
    status.value = 'Generating BFV keys in your browser…'
    requestedParameters.value = parameters()
    clearSessionData()
    await initializeSession()
    if (sessionError.value) throw sessionError.value

    const session = sessionData.value!
    keyFingerprint.value = session.descriptor.keyFingerprint
    contextFingerprint.value = session.contextFingerprint
    resultId.value = ''
    decryptedResult.value = ''
    inputs.value.forEach(input => input.objectId = '')
    debugSession.value = he.getDebugSession()
    status.value = 'Key session ready. The secret key exists only in this tab.'
  })
}

function resetSession(): void {
  he.dispose()
  clearSessionData()
  clearExecutionData()
  requestedParameters.value = null
  requestedExecution.value = null
  keyFingerprint.value = ''
  contextFingerprint.value = ''
  resultId.value = ''
  decryptedResult.value = ''
  debugSession.value = null
  inputs.value.forEach(input => input.objectId = '')
  status.value = 'Session reset. Previously uploaded values cannot be decrypted here.'
  errorMessage.value = ''
}

async function uploadInputs(): Promise<void> {
  await runAction(async () => {
    status.value = 'Encrypting and uploading inputs…'
    for (const input of inputs.value) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(input.name)) {
        throw new Error(`Invalid input name: ${input.name}`)
      }
      input.objectId = (await he.upload(input.value)).id
    }
    clearExecutionData()
    resultId.value = ''
    decryptedResult.value = ''
    status.value = 'Encrypted inputs uploaded.'
  })
}

async function executeExpression(): Promise<void> {
  await runAction(async () => {
    const inputMap = Object.fromEntries(inputs.value.map((input) => {
      if (!input.objectId) throw new Error(`Upload input ${input.name} before executing.`)
      return [input.name, input.objectId]
    }))

    let logic: unknown
    try {
      logic = JSON.parse(expression.value)
    } catch {
      throw new Error('Expression must be valid JSON.')
    }

    requestedExecution.value = { inputs: inputMap, logic }
    clearExecutionData()
    status.value = 'Evaluating and decrypting the result…'
    await runExecution()
    if (executionError.value) throw executionError.value

    resultId.value = executionData.value!.id
    decryptedResult.value = executionData.value!.decrypted
    status.value = 'Result decrypted locally.'
  })
}

async function decryptResult(): Promise<void> {
  await runAction(async () => {
    if (!resultId.value) throw new Error('Execute an expression first.')
    status.value = 'Downloading and decrypting result in your browser…'
    decryptedResult.value = String(await he.downloadAndDecrypt(resultId.value))
    status.value = 'Result decrypted locally.'
  })
}

function addInput(): void {
  inputs.value.push({ name: `value${inputs.value.length + 1}`, value: '0', objectId: '' })
}

function removeInput(index: number): void {
  if (inputs.value.length > 1) inputs.value.splice(index, 1)
}
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <div class="mx-auto max-w-5xl space-y-8">
      <div class="space-y-4">
        <UBadge
          color="primary"
          variant="subtle"
        >
          BFV · JSON Logic · Microsoft SEAL
        </UBadge>
        <h1 class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
          Compute on encrypted integers.
        </h1>
        <p class="max-w-3xl text-lg text-muted">
          Your browser creates the keys, encrypts the values, and decrypts the
          result. The Nitro API only receives ciphertexts and evaluation keys.
        </p>
      </div>

      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-key-round"
        title="The secret key lives only in memory"
        description="Reloading this page or resetting the session makes existing ciphertexts undecryptable in this playground."
      />

      <div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <UCard>
          <template #header>
            <div>
              <p class="font-semibold text-highlighted">
                1. Encryption context
              </p>
              <p class="mt-1 text-sm text-muted">
                Client-selected BFV parameters sent as HTTP headers.
              </p>
            </div>
          </template>

          <div class="space-y-4">
            <UFormField label="Polynomial modulus degree">
              <USelect
                v-model="degree"
                :items="[4096, 8192]"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Coefficient modulus bit sizes">
              <UInput
                v-model="coeffBits"
                class="w-full"
                placeholder="36,36,37"
              />
            </UFormField>
            <UFormField label="Plain modulus bit size">
              <UInput
                v-model.number="plainBits"
                type="number"
                :min="2"
                :max="30"
                class="w-full"
              />
            </UFormField>

            <div class="flex flex-wrap gap-2 pt-2">
              <UButton
                :loading="busy"
                icon="i-lucide-key"
                @click="generateSession"
              >
                Generate session
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                :disabled="busy || !keyFingerprint"
                @click="resetSession"
              >
                Reset
              </UButton>
            </div>

            <dl
              v-if="keyFingerprint"
              class="space-y-3 rounded-lg bg-elevated p-4 text-xs"
            >
              <div>
                <dt class="font-medium text-muted">
                  Context fingerprint
                </dt>
                <dd class="mt-1 break-all font-mono text-highlighted">
                  {{ contextFingerprint }}
                </dd>
              </div>
              <div>
                <dt class="font-medium text-muted">
                  Key fingerprint
                </dt>
                <dd class="mt-1 break-all font-mono text-highlighted">
                  {{ keyFingerprint }}
                </dd>
              </div>
            </dl>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="font-semibold text-highlighted">
                  2. Encrypt inputs
                </p>
                <p class="mt-1 text-sm text-muted">
                  Each value becomes an immutable ciphertext object.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-plus"
                @click="addInput"
              >
                Add input
              </UButton>
            </div>
          </template>

          <div class="space-y-4">
            <div
              v-for="(input, index) in inputs"
              :key="index"
              class="grid gap-3 rounded-lg border border-default p-4 sm:grid-cols-[1fr_1fr_auto]"
            >
              <UFormField label="Name">
                <UInput
                  v-model="input.name"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Integer value">
                <UInput
                  v-model="input.value"
                  class="w-full"
                  inputmode="numeric"
                />
              </UFormField>
              <UButton
                class="self-end"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :disabled="inputs.length === 1"
                aria-label="Remove input"
                @click="removeInput(index)"
              />
              <p
                v-if="input.objectId"
                class="break-all font-mono text-xs text-muted sm:col-span-3"
              >
                {{ input.objectId }}
              </p>
            </div>
            <UButton
              :loading="busy"
              :disabled="!keyFingerprint"
              icon="i-lucide-lock-keyhole"
              @click="uploadInputs"
            >
              Encrypt and upload
            </UButton>
          </div>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div>
            <p class="font-semibold text-highlighted">
              3. Execute JSON Logic
            </p>
            <p class="mt-1 text-sm text-muted">
              Supported operators are <code>var</code>, <code>+</code>, <code>-</code>, and <code>*</code>.
            </p>
          </div>
        </template>

        <div class="grid gap-6 lg:grid-cols-2">
          <UFormField label="Expression">
            <UTextarea
              v-model="expression"
              :rows="14"
              autoresize
              class="w-full font-mono"
            />
          </UFormField>

          <div class="flex flex-col justify-between gap-6 rounded-lg bg-elevated p-5">
            <div class="space-y-4">
              <div>
                <p class="text-sm font-medium text-muted">
                  Encrypted result object
                </p>
                <p class="mt-1 min-h-5 break-all font-mono text-xs text-highlighted">
                  {{ resultId || 'Not created yet' }}
                </p>
              </div>
              <div>
                <p class="text-sm font-medium text-muted">
                  Decrypted result
                </p>
                <p class="mt-1 text-4xl font-semibold text-primary">
                  {{ decryptedResult || '—' }}
                </p>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                :loading="busy"
                :disabled="!keyFingerprint"
                icon="i-lucide-cpu"
                @click="executeExpression"
              >
                Execute
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                :loading="busy"
                :disabled="!resultId"
                icon="i-lucide-unlock"
                @click="decryptResult"
              >
                Download and decrypt
              </UButton>
            </div>
          </div>
        </div>
      </UCard>

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Request failed"
        :description="errorMessage"
      />
      <div
        class="flex items-center gap-2 text-sm text-muted"
        aria-live="polite"
      >
        <UIcon
          :name="busy ? 'i-lucide-loader-circle' : 'i-lucide-info'"
          :class="{ 'animate-spin': busy }"
        />
        <span>{{ status }}</span>
      </div>

      <UCard>
        <template #header>
          <div>
            <p class="font-semibold text-highlighted">
              Debug session
            </p>
            <p class="mt-1 text-sm text-muted">
              Inspect the active in-memory BFV context and serialized keys.
            </p>
          </div>
        </template>

        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Sensitive key material"
          description="The secret key below can decrypt this session's ciphertexts. Do not copy or share it outside a disposable debug session."
        />

        <div
          v-if="debugSession"
          class="mt-6 space-y-6"
        >
          <dl class="grid gap-4 rounded-lg bg-elevated p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt class="text-muted">
                Created
              </dt>
              <dd class="mt-1 font-mono text-xs text-highlighted">
                {{ debugSession.createdAt }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Scheme
              </dt>
              <dd class="mt-1 font-mono text-highlighted">
                {{ debugSession.descriptor.scheme }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Polynomial degree
              </dt>
              <dd class="mt-1 font-mono text-highlighted">
                {{ debugSession.descriptor.polyModulusDegree }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Coefficient modulus bits
              </dt>
              <dd class="mt-1 font-mono text-highlighted">
                {{ debugSession.descriptor.coeffModulusBits.join(', ') }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Plain modulus bits
              </dt>
              <dd class="mt-1 font-mono text-highlighted">
                {{ debugSession.descriptor.plainModulusBits }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Context fingerprint
              </dt>
              <dd class="mt-1 break-all font-mono text-xs text-highlighted">
                {{ debugSession.contextFingerprint }}
              </dd>
            </div>
            <div class="sm:col-span-2 lg:col-span-3">
              <dt class="text-muted">
                Public-key fingerprint
              </dt>
              <dd class="mt-1 break-all font-mono text-xs text-highlighted">
                {{ debugSession.descriptor.keyFingerprint }}
              </dd>
            </div>
          </dl>

          <details
            v-for="(key, name) in debugSession.keys"
            :key="name"
            class="rounded-lg border border-default p-4"
          >
            <summary class="cursor-pointer font-medium capitalize text-highlighted">
              {{ name }} key · {{ key.byteLength.toLocaleString() }} bytes
            </summary>
            <textarea
              :value="key.base64"
              readonly
              spellcheck="false"
              rows="6"
              class="mt-4 w-full resize-y rounded-md border border-default bg-default p-3 font-mono text-xs text-highlighted"
            />
          </details>
        </div>

        <p
          v-else
          class="mt-6 text-sm text-muted"
        >
          Generate a key session to inspect its debug information.
        </p>
      </UCard>
    </div>
  </UContainer>
</template>
