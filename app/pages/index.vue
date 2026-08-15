<script setup lang="ts">
import { z } from 'zod'
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

const contextSchema = z.object({
  degree: z.union([z.literal(4096), z.literal(8192)]),
  coeffBits: z.string().regex(/^\d+(\s*,\s*\d+)*$/, 'Use comma-separated positive integers.'),
  plainBits: z.number().int().min(2).max(30)
})

const inputSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use a letter followed by letters, numbers, or underscores.'),
  value: z.string().regex(/^-?\d+$/, 'Enter an integer.')
})

const inputsSchema = z.object({ inputs: z.array(inputSchema).min(1) })

const executionSchema = z.object({
  expression: z.string().refine((value) => {
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }, 'Expression must be valid JSON.')
})

const he = useHEClient()

const contextForm = reactive({
  degree: 4096 as 4096 | 8192,
  coeffBits: '36,36,37',
  plainBits: 20
})

const inputsForm = reactive<{ inputs: PlaygroundInput[] }>({
  inputs: [
    { name: 'a', value: '10', objectId: '' },
    { name: 'b', value: '17', objectId: '' }
  ]
})

const executionForm = reactive({
  expression: JSON.stringify({ '*': [{ var: 'a' }, { var: 'b' }] }, null, 2)
})

const resultId = ref('')
const decryptedResult = ref('')
const status = ref('No active key session.')
const debugSession = shallowRef<ReturnType<typeof he.getDebugSession>>(null)
const requestedParameters = shallowRef<HEParameterDescriptor | null>(null)
const requestedExecution = shallowRef<ExecuteRequest | null>(null)

const {
  status: sessionRequestStatus,
  execute: initializeSession,
  clear: clearSessionData
} = await useAsyncData('he-session',
  async () => {
    if (!requestedParameters.value) throw new Error('Encryption parameters are required.')
    return he.initialize(requestedParameters.value)
  },
  { immediate: false }
)

const {
  data: executionData,
  status: executionRequestStatus,
  execute: runExecution,
  clear: clearExecutionData
} = await useAsyncData('he-execution',
  async () => {
    if (!requestedExecution.value) throw new Error('An execution request is required.')
    const id = await he.execute(requestedExecution.value)
    const decrypted = await he.downloadAndDecrypt(id)
    return { id, decrypted: String(decrypted) }
  },
  { immediate: false }
)

clearSessionData()
clearExecutionData()

function parameters(): HEParameterDescriptor {
  return {
    scheme: 'BFV',
    polyModulusDegree: contextForm.degree,
    coeffModulusBits: contextForm.coeffBits.split(',').map(value => Number(value.trim())),
    plainModulusBits: contextForm.plainBits
  }
}

async function generateSession(): Promise<void> {
  status.value = 'Generating BFV keys in your browser…'
  requestedParameters.value = parameters()
  clearSessionData()
  await initializeSession()

  resultId.value = ''
  decryptedResult.value = ''
  inputsForm.inputs.forEach(input => input.objectId = '')
  debugSession.value = he.getDebugSession()
  status.value = 'Key session ready. The secret key exists only in this tab.'
}

async function uploadInputs(): Promise<void> {
  status.value = 'Encrypting and uploading inputs…'

  await Promise.all(inputsForm.inputs.map(async (input) => {
    input.objectId = (await he.upload(input.value)).id
  }))
  clearExecutionData()

  resultId.value = ''
  decryptedResult.value = ''
  status.value = 'Encrypted inputs uploaded.'
}

async function executeExpression(): Promise<void> {
  const inputMap = Object.fromEntries(inputsForm.inputs.map((input) => {
    if (!input.objectId) throw new Error(`Upload input ${input.name} before executing.`)
    return [input.name, input.objectId]
  }))

  const logic = JSON.parse(executionForm.expression)
  requestedExecution.value = { inputs: inputMap, logic }
  clearExecutionData()

  status.value = 'Evaluating and decrypting the result…'
  await runExecution()

  resultId.value = executionData.value!.id
  decryptedResult.value = executionData.value!.decrypted
  status.value = 'Result decrypted locally.'
}

async function decryptResult(): Promise<void> {
  status.value = 'Downloading and decrypting result in your browser…'
  decryptedResult.value = String(await he.downloadAndDecrypt(resultId.value))
  status.value = 'Result decrypted locally.'
}

function addInput(): void {
  inputsForm.inputs.push({ name: `value${inputsForm.inputs.length + 1}`, value: '0', objectId: '' })
}

function removeInput(index: number): void {
  if (inputsForm.inputs.length > 1) inputsForm.inputs.splice(index, 1)
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

          <UForm
            :schema="contextSchema"
            :state="contextForm"
            class="space-y-4"
            @submit="generateSession"
          >
            <UFormField label="Polynomial modulus degree">
              <USelect
                v-model="contextForm.degree"
                :items="[4096, 8192]"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Coefficient modulus bit sizes">
              <UInput
                v-model="contextForm.coeffBits"
                class="w-full"
                placeholder="36,36,37"
              />
            </UFormField>
            <UFormField label="Plain modulus bit size">
              <UInput
                v-model.number="contextForm.plainBits"
                type="number"
                :min="2"
                :max="30"
                class="w-full"
              />
            </UFormField>

            <div class="flex flex-wrap gap-2 pt-2">
              <UButton
                :loading="sessionRequestStatus === 'pending'"
                icon="i-lucide-key"
                type="submit"
              >
                Generate session
              </UButton>
            </div>

            <dl class="grid grid-cols-3 gap-3 rounded-lg bg-elevated p-4 text-xs">
              <div>
                <dt class="text-muted">
                  Polynomial degree
                </dt>
                <dd class="mt-1 font-mono text-highlighted">
                  {{ contextForm.degree }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Coefficient bits
                </dt>
                <dd class="mt-1 break-all font-mono text-highlighted">
                  {{ contextForm.coeffBits }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Plain bits
                </dt>
                <dd class="mt-1 font-mono text-highlighted">
                  {{ contextForm.plainBits }}
                </dd>
              </div>
            </dl>
          </UForm>
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

          <UForm
            :schema="inputsSchema"
            :state="inputsForm"
            class="space-y-4"
            @submit="uploadInputs"
          >
            <div
              v-for="(input, index) in inputsForm.inputs"
              :key="index"
              class="grid gap-3 rounded-lg border border-default p-4 sm:grid-cols-[1fr_1fr_auto]"
            >
              <UFormField
                label="Name"
                :name="`inputs.${index}.name`"
              >
                <UInput
                  v-model="input.name"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Integer value"
                :name="`inputs.${index}.value`"
              >
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
                type="button"
                :disabled="inputsForm.inputs.length === 1"
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
              :loading="sessionRequestStatus === 'pending'"
              type="submit"
              icon="i-lucide-lock-keyhole"
            >
              Encrypt and upload
            </UButton>
          </UForm>
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

        <UForm
          :schema="executionSchema"
          :state="executionForm"
          class="grid gap-6 lg:grid-cols-2"
          @submit="executeExpression"
        >
          <UFormField label="Expression">
            <UTextarea
              v-model="executionForm.expression"
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
                :loading="executionRequestStatus === 'pending'"
                type="submit"
                icon="i-lucide-cpu"
              >
                Execute
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                :loading="executionRequestStatus === 'pending'"
                type="button"
                icon="i-lucide-unlock"
                @click="decryptResult"
              >
                Download and decrypt
              </UButton>
            </div>
          </div>
        </UForm>
      </UCard>

      <div
        class="flex items-center gap-2 text-sm text-muted"
        aria-live="polite"
      >
        <UIcon
          :name="sessionRequestStatus === 'pending' || executionRequestStatus === 'pending' ? 'i-lucide-loader-circle' : 'i-lucide-info'"
          :class="{ 'animate-spin': sessionRequestStatus === 'pending' || executionRequestStatus === 'pending' }"
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
