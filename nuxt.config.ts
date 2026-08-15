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
    cloudflare: {
      deployConfig: true,
      wrangler: {
        r2_buckets: [
          {
            binding: 'HE_OBJECTS',
            bucket_name: 'hmmf'
          }
        ],
        observability: {
          enabled: true
        }
      }
    },

    experimental: {
      wasm: true
    },

    routeRules: {
      '/**/*.wasm': {
        headers: { 'Content-Type': 'application/wasm' }
      }
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

  vite: {
    optimizeDeps: {
      exclude: ['node-seal']
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
