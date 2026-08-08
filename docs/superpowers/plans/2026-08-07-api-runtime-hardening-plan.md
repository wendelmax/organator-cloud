# API Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the NestJS/Fastify runtime so production starts only with valid security configuration and rejects unsafe HTTP traffic.

**Architecture:** A focused security configuration module validates the process environment before bootstrap. `main.ts` consumes the parsed configuration to register Fastify-native security plugins and the global Nest validation pipeline; tests exercise pure parsing and the application HTTP boundary.

**Tech Stack:** NestJS 11, Fastify 5, `@fastify/helmet`, `@fastify/rate-limit`, class-validator, Jest, Supertest.

## Global Constraints

- Production requires a non-default `JWT_SECRET` of at least 32 characters.
- Production requires `ENCRYPTION_KEY` as exactly 64 hexadecimal characters.
- Production requires a non-empty, comma-separated `CORS_ORIGINS` allowlist of HTTP(S) origins; wildcards are invalid.
- Development retains explicitly documented local defaults only.
- HTTP body limit is 1 MiB; validation whitelists DTO fields and rejects unknown fields.
- `/health` receives a more permissive but finite rate limit than the global API limit.
- Proxy headers are untrusted by default; known ingress deployments set `TRUST_PROXY_HOPS` explicitly.
- Node is pinned to the 24 LTS line. TypeScript 7, Prisma 7 and ESLint 10 in the web app remain compatibility migrations rather than unsafe numeric bumps.

---

### Task 1: Add the security configuration contract

**Files:**
- Create: `apps/control-plane-api/src/common/security.config.ts`
- Test: `apps/control-plane-api/src/common/security.config.spec.ts`
- Modify: `apps/control-plane-api/src/auth/auth.module.ts`
- Modify: `packages/cloud-providers/src/crypto.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `readSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig`
- Produces: `SecurityConfig = { isProduction: boolean; corsOrigins: string[]; jwtSecret: string; encryptionKey: string; bodyLimit: number; trustProxy: number | false; rateLimit: { max: number; timeWindow: number }; healthRateLimit: { max: number; timeWindow: number } }`
- Consumes: `process.env` from bootstrap, JWT module and crypto helper.

- [ ] **Step 1: Write failing parser tests**

```ts
expect(() => readSecurityConfig({ NODE_ENV: 'production' })).toThrow('JWT_SECRET');
expect(() => readSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: 'a'.repeat(64), CORS_ORIGINS: '*' })).toThrow('CORS_ORIGINS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace control-plane-api test -- common/security.config.spec.ts --runInBand`

Expected: FAIL because `security.config.ts` does not exist.

- [ ] **Step 3: Implement `readSecurityConfig` and consume it centrally**

Implement strict production validation, parse CSV origins with `new URL`, and export typed values. Replace the JWT module fallback and encryption-key fallback in production with this shared contract.

- [ ] **Step 4: Run parser and affected auth/crypto tests**

Run: `npm --workspace control-plane-api test -- common/security.config.spec.ts auth/auth.controller.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Document production variables**

Add `CORS_ORIGINS`, `RATE_LIMIT_MAX`, `HEALTH_RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `TRUST_PROXY_HOPS`, and development/production guidance to `.env.example`; never put a production secret in the file.

### Task 2: Apply Fastify security middleware and validation

**Files:**
- Modify: `apps/control-plane-api/package.json`
- Modify: `package-lock.json`
- Modify: `apps/control-plane-api/src/main.ts`
- Modify: `apps/control-plane-api/src/app.controller.ts`
- Test: `apps/control-plane-api/test/app.e2e-spec.ts`
- Modify: `apps/control-plane-api/Dockerfile`
- Modify: `helm/organator-cloud/templates/control-plane-api.yaml`
- Modify: `helm/organator-cloud/values.yaml`

**Interfaces:**
- Consumes: `readSecurityConfig`, the Fastify adapter and `SecurityConfig` rate limits.
- Produces: globally configured CORS, helmet, rate limiter, 1 MiB body limit and ValidationPipe.

- [ ] **Step 1: Add failing HTTP integration tests**

```ts
expect((await request(app.getHttpServer()).get('/').set('Origin', 'https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
expect((await request(app.getHttpServer()).get('/')).headers['x-content-type-options']).toBe('nosniff');
```

Add a loop that exceeds a test-only global rate limit and expects HTTP 429. Add a DTO-backed test endpoint only if an existing endpoint cannot demonstrate `forbidNonWhitelisted` without product changes.

- [ ] **Step 2: Run the e2e test and verify it fails**

Run: `npm --workspace control-plane-api run test:e2e -- --runInBand`

Expected: FAIL because helmet and rate-limit behavior are absent.

- [ ] **Step 3: Install compatible Fastify plugins and configure bootstrap**

Install `@fastify/helmet` and `@fastify/rate-limit` versions compatible with Fastify 5. Create the adapter with `bodyLimit: 1048576` and a bounded trusted-proxy hop count; await plugin registration before initialization; enable parsed CORS origins, explicit methods and `Authorization,Content-Type` headers; add `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`; configure IP rate limiting and a finite health override.

- [ ] **Step 4: Run e2e tests**

Run: `npm --workspace control-plane-api run test:e2e -- --runInBand`

Expected: PASS, including HTTP 429 after the configured test limit.

### Task 3: Verify the production startup boundary

**Files:**
- Test: `apps/control-plane-api/src/common/security.config.spec.ts`
- Modify: `apps/control-plane-api/src/main.ts`
- Modify: `apps/control-plane-api/package.json`
- Modify: `apps/control-plane-api/tsconfig.build.json`

**Interfaces:**
- Consumes: production-like `SecurityConfig` fixtures.
- Produces: deterministic startup rejection before listening when configuration is unsafe.

- [ ] **Step 1: Add startup-boundary tests**

```ts
expect(() => readSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'super_secret_jwt_key_change_in_production' })).toThrow('JWT_SECRET');
expect(() => readSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: 'not-hex', CORS_ORIGINS: 'https://admin.example.com' })).toThrow('ENCRYPTION_KEY');
```

- [ ] **Step 2: Run complete API tests and build**

Run: `npm --workspace control-plane-api test -- --runInBand && npm --workspace control-plane-api run build && test -f apps/control-plane-api/dist/main.js`

Expected: all tests and the Nest build pass.

- [ ] **Step 3: Commit implementation**

Run: `git add .env.example package-lock.json apps/control-plane-api/package.json apps/control-plane-api/src/common/security.config.ts apps/control-plane-api/src/common/security.config.spec.ts apps/control-plane-api/src/main.ts apps/control-plane-api/src/auth/auth.module.ts packages/cloud-providers/src/crypto.ts apps/control-plane-api/test/app.e2e-spec.ts && git commit -m "feat(api): harden production runtime security"`
