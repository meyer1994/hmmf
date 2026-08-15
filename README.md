# HMMF

HMMF is a Nuxt/Nitro homomorphic-compute playground. The browser generates a BFV key session with `node-seal`, encrypts integer inputs, and decrypts the result. The API resolves immutable ciphertext objects from Nitro storage and evaluates an allowlisted JSON Logic expression without receiving the secret key.

Supported public operators are `var`, `+`, `-`, and `*`. Multiplication sends request-scoped relinearization keys; neither public nor evaluation keys are persisted.

## Setup

```bash
pnpm install
pnpm dev
```

Local development uses filesystem-backed Nitro storage under `.data/he`. The playground is available at `http://localhost:3000`.

## Cloudflare configuration

The production Nitro preset targets Cloudflare Workers. Before deploying, create the R2 bucket yourself and make sure this binding in `wrangler.jsonc` points at it:

```json
{
  "binding": "HE_OBJECTS",
  "bucket_name": "hmmf-he-objects"
}
```

Nitro mounts that binding as `useStorage('he')`. Change the bucket name in `wrangler.jsonc` if you use a different name. This repository does not create or deploy Cloudflare resources.

Build the Worker bundle with:

```bash
pnpm build
```

The generated entry point is `.output/server/index.mjs`; static assets are in `.output/public`.

## HTTP API

All endpoints use capability-style UUID object IDs and currently have no authentication layer.

### Upload a ciphertext

`POST /api/v1/objects` accepts `application/octet-stream` plus these headers:

- `X-HE-Scheme: BFV`
- `X-HE-Poly-Modulus-Degree: 4096` or `8192`
- `X-HE-Coeff-Modulus-Bits: 36,36,37`
- `X-HE-Plain-Modulus-Bits: 20`
- `X-HE-Key-Fingerprint: sha256:<public-key-hash>`

The response contains the immutable object ID and its context/key fingerprints.

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

Send the same HE parameter headers used for upload. When the expression contains `*`, add `"relinKeys": "<base64 relinearization keys>"` to the body. Omit it for addition and subtraction. The response is:

```json
{
  "result": {
    "id": "<result UUID>"
  }
}
```

Zod validates the request shape and recursive operator allowlist before the public operators are compiled to their internal HE operations.

### Download a ciphertext

`GET /api/v1/objects/:id` returns `application/octet-stream` and HE metadata headers. Decryption remains client-side.

## Verification

```bash
pnpm typecheck
pnpm build
```
