# Design Doc: Bug Fixes (#2, #3, #5, #6)

## Overview
Fix four identified bugs/security issues in the Organator Cloud codebase:
1. **Issue #2**: Payload mismatch in `POST /v1/services`.
2. **Issue #3**: Missing `tenantId` parameter when fetching services in frontend.
3. **Issue #5**: Login form not connected to NextAuth; hardcoded API base URLs.
4. **Issue #6**: Security vulnerabilities including hardcoded secrets, plain-text passwords, and Stripe webhook bypass.

---

## Technical Design & Strategy

### 1. Issue #2 - Fix `POST /v1/services` Payload Incompatibility
- **NestJS DTO (`apps/control-plane-api/src/services/dto/create-service.dto.ts`)**:
  - Create a DTO using `class-validator`:
    ```typescript
    export class CreateServiceDto {
      @IsString()
      @IsNotEmpty()
      tenantId: string;

      @IsString()
      @IsNotEmpty()
      name: string;

      @IsEnum(['VERCEL', 'AWS', 'DOCKER_VPS'])
      cloudProvider: 'VERCEL' | 'AWS' | 'DOCKER_VPS';

      @IsString()
      @IsNotEmpty()
      repositoryUrl?: string;

      @IsString()
      @IsOptional()
      repository?: string;
    }
    ```
  - In `services.controller.ts`, parse `repositoryUrl = body.repositoryUrl || body.repository`.
- **Frontend Action (`apps/backoffice-web/src/app/(dashboard)/services/actions.ts`)**:
  - Extract `tenantId` from NextAuth session.
  - Send `repositoryUrl` explicitly in body.

### 2. Issue #3 - Fix Missing `tenantId` in Services Fetching
- **Services Page (`apps/backoffice-web/src/app/(dashboard)/services/page.tsx`)**:
  - Get `tenantId` from session (`(session?.user as any)?.tenantId || (session as any)?.tenantId`).
  - If `tenantId` is present, call `${API_URL}/v1/services/tenant/${tenantId}`.
  - If no `tenantId`, return empty array and show feedback.

### 3. Issue #5 - Connect Login Form & Remove Hardcoded URLs
- **Login Page (`apps/backoffice-web/src/app/(auth)/login/page.tsx`)**:
  - Convert to client component (`"use client"`).
  - Use `signIn('credentials', { email, password, callbackUrl: '/services' })` on form submit.
  - Add state for loading indicator (`isSubmitting`) and error messages (`error`).
- **Environment Variables**:
  - Create/update central config helper or use `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'` in client files and `process.env.API_URL || 'http://localhost:3001'` in server files.
  - Update `actions.ts`, `register/ClientPage.tsx`, and `services/page.tsx`.

### 4. Issue #6 - Fix Security Issues (Secrets, Password Hash & Webhook)
- **Secrets & Startup Validation (`apps/control-plane-api/src/auth/auth.module.ts`, `main.ts`)**:
  - Fail startup or throw explicit errors if `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` are missing or default in non-test production setups.
- **Password Hashing (`apps/control-plane-api/src/auth/auth.service.ts`)**:
  - Use `bcrypt.compare(pass, user.password)` in `validateUser`.
  - When creating users in `tenants.service.ts` or user registration, hash passwords with `bcrypt.hash(password, 10)`.
- **Stripe Webhook Bypass (`apps/control-plane-api/src/onboarding/onboarding.controller.ts`)**:
  - Remove signature bypass fallback (`secret === 'whsec_test' && !signature`). Always verify signature with `stripe.webhooks.constructEvent`.

---

## Verification Plan
1. Run `npx turbo run build` to verify TypeScript builds for all packages and apps.
2. Run test suites (`npx turbo run test` or package-specific `npm test`).
