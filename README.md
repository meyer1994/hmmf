# HMMF

HMMF is a Nuxt/Nitro homomorphic-compute playground. The browser generates a BFV key session with `node-seal`, encrypts integer inputs, and decrypts the result. The API resolves immutable ciphertext objects from Nitro storage and evaluates an allowlisted JSON Logic expression without receiving the secret key.

Supported public operators are `var`, `+`, `-`, and `*`. Each execution sends request-scoped relinearization keys; neither public nor evaluation keys are persisted.

## Setup

```bash
pnpm install
pnpm dev
```

Local development uses filesystem-backed Nitro storage under `.data/he`. The playground is available at `http://localhost:3000`.

## Cloudflare Workers

The production Nitro preset targets Cloudflare Workers and uses an R2 bucket for ciphertext storage. The configuration uses the `cloudflare_module` preset and a compatibility date supported by Cloudflare Workers.

Create the R2 bucket, then set its name in `nuxt.config.ts` under the `HE_OBJECTS` binding:

```ts
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
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
        ]
      }
    }
  }
})
```

Nitro mounts that binding as `useStorage('he')`. The generated `wrangler.jsonc` contains the same R2 binding. This repository does not create Cloudflare resources.

Build the Worker bundle with:

```bash
pnpm build
```

The generated entry point is `.output/server/index.mjs`; static assets are in `.output/public`.

## HTTP API

All endpoints use capability-style UUID object IDs and currently have no authentication layer.

### Upload a ciphertext

`POST /api/v1/vars` accepts `application/octet-stream` plus these headers:

- `X-HE-Scheme: BFV`
- `X-HE-Poly-Modulus-Degree: 4096` or `8192`
- `X-HE-Coeff-Modulus-Bits: 36,36,37`
- `X-HE-Plain-Modulus-Bits: 20`

The response contains the immutable object ID.

### Execute an expression

`POST /api/v1/execute` accepts an `application/json` body:

```json
{
  "inputs": {
    "a": "<object UUID>",
    "b": "<object UUID>"
  },
  "logic": {
    "+": [
      { "var": "a" },
      { "var": "b" }
    ]
  }
}
```

Send the same HE parameter headers used for upload and include the base64-encoded relinearization keys in the request body. The response is:

```json
{
  "result": {
    "id": "<result UUID>"
  }
}
```

Zod validates the request shape and recursive operator allowlist before the public operators are compiled to their internal HE operations.

### Download a ciphertext

`GET /api/v1/vars/:id` returns `application/octet-stream` and the HE parameter headers. Decryption remains client-side. If the parameters or key session do not match, decryption fails rather than being server-validated by a fingerprint.

## Verification

```bash
pnpm typecheck
pnpm build
```
