<script setup lang="ts">
import type { HEParameterDescriptor } from '~~/shared/he'

interface DemoFormula {
  name: string
  description: string
  inputs: { name: string, label: string, value: string }[]
  logic: unknown
  constants: Record<string, string>
}

const formulas: Record<string, DemoFormula> = {
  loan: {
    name: 'Loan readiness score',
    description: 'A toy financial score calculated without exposing income, savings, or debt.',
    inputs: [
      { name: 'income', label: 'Annual income', value: '60000' },
      { name: 'savings', label: 'Savings', value: '20000' },
      { name: 'debt', label: 'Debt', value: '15000' }
    ],
    logic: {
      '+': [
        { '*': [{ var: 'income' }, { var: 'incomeWeight' }] },
        { '-': [{ '*': [{ var: 'savings' }, { var: 'savingsWeight' }] }, { var: 'debt' }] }
      ]
    },
    constants: { incomeWeight: '2', savingsWeight: '3' }
  },
  fitness: {
    name: 'Fitness score',
    description: 'Combines sleep, workouts, and recovery into a simple private score.',
    inputs: [
      { name: 'sleep', label: 'Hours slept', value: '8' },
      { name: 'workouts', label: 'Workouts this week', value: '4' },
      { name: 'recovery', label: 'Recovery points', value: '7' }
    ],
    logic: {
      '+': [
        { '*': [{ var: 'sleep' }, { var: 'sleepWeight' }] },
        { '+': [{ '*': [{ var: 'workouts' }, { var: 'workoutWeight' }] }, { var: 'recovery' }] }
      ]
    },
    constants: { sleepWeight: '2', workoutWeight: '5' }
  },
  business: {
    name: 'Business health score',
    description: 'Calculates a toy KPI from revenue, costs, and customer count.',
    inputs: [
      { name: 'revenue', label: 'Revenue', value: '120000' },
      { name: 'costs', label: 'Costs', value: '70000' },
      { name: 'customers', label: 'Customers', value: '250' }
    ],
    logic: {
      '+': [
        { '-': [{ var: 'revenue' }, { '*': [{ var: 'costs' }, { var: 'costWeight' }] }] },
        { '*': [{ var: 'customers' }, { var: 'customerWeight' }] }
      ]
    },
    constants: { costWeight: '2', customerWeight: '10' }
  }
}

const he = useHEClient()
const selectedFormula = ref('loan')
const inputs = ref(formulas.loan!.inputs.map(input => ({ ...input })))
const result = ref('')
const status = ref('Ready to encrypt a demo calculation.')
const busy = ref(false)

const formula = computed(() => formulas[selectedFormula.value]!)

watch(selectedFormula, (key) => {
  inputs.value = formulas[key]!.inputs.map(input => ({ ...input }))
  result.value = ''
  status.value = 'Ready to encrypt a demo calculation.'
})

const parameters: HEParameterDescriptor = {
  scheme: 'BFV',
  polyModulusDegree: 4096,
  coeffModulusBits: [36, 36, 37],
  plainModulusBits: 20
}

function formatLogic(logic: unknown): string {
  return JSON.stringify(logic, null, 2)
}

async function runDemo(): Promise<void> {
  busy.value = true
  status.value = 'Generating keys in your browser…'

  try {
    await he.initialize(parameters)
    const values = [
      ...inputs.value.map(input => [input.name, input.value] as const),
      ...Object.entries(formula.value.constants)
    ]
    const encryptedInputs = Object.fromEntries(await Promise.all(
      values.map(async ([name, value]) => [name, (await he.upload(value)).id])
    ))

    status.value = 'Evaluating the encrypted formula…'
    const resultId = await he.execute({
      inputs: encryptedInputs,
      logic: formula.value.logic
    })

    result.value = String(await he.downloadAndDecrypt(resultId))
    status.value = 'Computed and decrypted locally.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <div class="mx-auto max-w-4xl space-y-8">
      <div class="space-y-4">
        <UBadge
          color="primary"
          variant="subtle"
        >
          Private computation demo
        </UBadge>
        <h1 class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
          Share the calculation, not the data.
        </h1>
        <p class="max-w-3xl text-lg text-muted">
          Choose a formula, enter sensitive values, and let the server compute on ciphertexts.
          Your browser creates the keys and decrypts the result.
        </p>
      </div>

      <UCard>
        <template #header>
          <div>
            <p class="font-semibold text-highlighted">
              Choose a built-in formula
            </p>
            <p class="mt-1 text-sm text-muted">
              These are illustrative scores, not financial or medical advice.
            </p>
          </div>
        </template>

        <div class="space-y-6">
          <USelect
            v-model="selectedFormula"
            :items="Object.entries(formulas).map(([value, item]) => ({ label: item.name, value }))"
            value-key="value"
            class="w-full"
          />

          <div class="grid gap-6 lg:grid-cols-2">
            <div class="space-y-4">
              <div>
                <h2 class="font-semibold text-highlighted">
                  {{ formula.name }}
                </h2>
                <p class="mt-1 text-sm text-muted">
                  {{ formula.description }}
                </p>
              </div>

              <UFormField
                v-for="input in inputs"
                :key="input.name"
                :label="input.label"
              >
                <UInput
                  v-model="input.value"
                  type="number"
                  inputmode="numeric"
                  class="w-full"
                />
              </UFormField>

              <UButton
                :loading="busy"
                icon="i-lucide-shield-check"
                @click="runDemo"
              >
                Encrypt and calculate
              </UButton>
            </div>

            <div class="space-y-4 rounded-lg bg-elevated p-5">
              <div>
                <p class="text-sm font-medium text-muted">
                  JSON Logic formula
                </p>
                <pre class="mt-2 overflow-x-auto text-xs text-highlighted">{{ formatLogic(formula.logic) }}</pre>
              </div>
              <div class="border-t border-default pt-4">
                <p class="text-sm font-medium text-muted">
                  Decrypted result
                </p>
                <p class="mt-1 text-4xl font-semibold text-primary">
                  {{ result || '—' }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </UCard>

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
    </div>
  </UContainer>
</template>
