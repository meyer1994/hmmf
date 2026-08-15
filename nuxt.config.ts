// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2026-08-14',

  nitro: {
    preset: 'cloudflare_module',
    experimental: {
      wasm: true
    },
    storage: {
      he: {
        driver: 'cloudflare-r2-binding',
        binding: 'HE_OBJECTS',
        base: 'hmmf'
      }
    },
    devStorage: {
      he: {
        driver: 'fs',
        base: './.data/he'
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})