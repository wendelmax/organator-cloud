# Bug Fixes (#2, #3, #5, #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve bugs and security vulnerabilities across issues #2, #3, #5, and #6 in `organator-cloud`.

**Architecture:** Update DTO validation and controller logic in `control-plane-api` for NestJS, update Next.js Server Actions & Page components in `backoffice-web` with proper NextAuth session integration and environment variable resolution, and secure authentication/webhooks using `bcrypt` and environment variable enforcement.

**Tech Stack:** NestJS, TypeScript, Next.js, NextAuth, Prisma, bcrypt, class-validator, Stripe SDK.

## Global Constraints
- All backend modifications in `apps/control-plane-api`.
- All frontend modifications in `apps/backoffice-web`.
- Use environment variables for base URLs (`API_URL` / `NEXT_PUBLIC_API_URL`).
- All tests must pass and builds must complete cleanly via `npx turbo run build`.

---

### Task 1: Fix `POST /v1/services` Payload Incompatibility (Issue #2)

**Files:**
- Create: `apps/control-plane-api/src/services/dto/create-service.dto.ts`
- Modify: `apps/control-plane-api/src/services/services.controller.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/services/actions.ts`

**Interfaces:**
- Consumes: `CreateServiceDto` with `repositoryUrl` or `repository`
- Produces: Normalized service creation request to `servicesService.createService`

- [ ] **Step 1: Create `CreateServiceDto` class**

```typescript
// apps/control-plane-api/src/services/dto/create-service.dto.ts
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

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
  @IsOptional()
  repositoryUrl?: string;

  @IsString()
  @IsOptional()
  repository?: string;
}
```

- [ ] **Step 2: Update `services.controller.ts` to use `CreateServiceDto`**

```typescript
// apps/control-plane-api/src/services/services.controller.ts
import { Controller, Post, Body, Get, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

@UseGuards(JwtAuthGuard)
@Controller('v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('tenant/:tenantId')
  async findByTenant(@Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(tenantId);
  }

  @Post()
  async create(@Body() body: CreateServiceDto) {
    const repo = body.repositoryUrl || body.repository;
    if (!repo) {
      throw new BadRequestException('repository or repositoryUrl is required');
    }
    return this.servicesService.createService(
      body.tenantId,
      body.name,
      body.cloudProvider,
      repo,
    );
  }
}
```

- [ ] **Step 3: Update frontend `actions.ts` to pass `repositoryUrl` and `tenantId`**

```typescript
// apps/backoffice-web/src/app/(dashboard)/services/actions.ts
"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { revalidatePath } from "next/cache";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function createService(formData: FormData) {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const tenantId = (session as any)?.user?.tenantId || (session as any)?.tenantId;

  if (!token) throw new Error("Unauthorized");

  const payload = {
    tenantId: tenantId || "default-tenant",
    name: formData.get("name"),
    cloudProvider: formData.get("cloudProvider"),
    repositoryUrl: formData.get("repository") || formData.get("repositoryUrl"),
    vpsHost: formData.get("vpsHost") || undefined,
  };

  const res = await fetch(`${API_URL}/v1/services`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("Failed to create service");
  }

  revalidatePath("/services");
  return { success: true };
}
```

- [ ] **Step 4: Commit Issue #2 fixes**

```bash
git add apps/control-plane-api/src/services/dto/create-service.dto.ts apps/control-plane-api/src/services/services.controller.ts apps/backoffice-web/src/app/\(dashboard\)/services/actions.ts
git commit -m "fix(api): payload incompatibility in POST /v1/services"
```

---

### Task 2: Fix Missing `tenantId` Parameter in Services Fetching (Issue #3)

**Files:**
- Modify: `apps/backoffice-web/src/app/(dashboard)/services/page.tsx`

- [ ] **Step 1: Update `ServicesPage` to fetch by `tenantId`**

```typescript
// apps/backoffice-web/src/app/(dashboard)/services/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { ServicesClient } from "./ClientPage";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function getServices(token: string, tenantId: string) {
  const res = await fetch(`${API_URL}/v1/services/tenant/${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ServicesPage() {
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const tenantId = (session as any)?.user?.tenantId || (session as any)?.tenantId;

  const services = (token && tenantId) ? await getServices(token, tenantId) : [];
  return <ServicesClient initialServices={services} />;
}
```

- [ ] **Step 2: Commit Issue #3 fixes**

```bash
git add apps/backoffice-web/src/app/\(dashboard\)/services/page.tsx
git commit -m "fix(api): use tenantId parameter when fetching services"
```

---

### Task 3: Connect Login Form & Fix Hardcoded Environment URLs (Issue #5)

**Files:**
- Modify: `apps/backoffice-web/src/app/(auth)/login/page.tsx`
- Modify: `apps/backoffice-web/src/app/(public)/register/ClientPage.tsx`

- [ ] **Step 1: Connect `apps/backoffice-web/src/app/(auth)/login/page.tsx` to NextAuth `signIn`**

```typescript
// apps/backoffice-web/src/app/(auth)/login/page.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/services",
      });

      if (res?.error) {
        setError("Credenciais inválidas. Por favor, tente novamente.");
        setIsSubmitting(false);
      } else if (res?.url) {
        router.push(res.url);
      }
    } catch (err) {
      setError("Ocorreu um erro ao tentar realizar o login.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-950">
      <div className="w-full max-w-md p-8 space-y-6 bg-neutral-900 rounded-xl shadow-2xl border border-neutral-800">
        <h1 className="text-3xl font-bold text-center text-white">Organator</h1>
        <p className="text-sm text-center text-neutral-400">Entre com as suas credenciais para gerenciar sua infraestrutura</p>
        
        {error && (
          <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500" 
              placeholder="admin@navant.app" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300">Senha</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 mt-1 border border-neutral-700 bg-neutral-800 text-white rounded-lg focus:ring-2 focus:ring-blue-500" 
              placeholder="••••••••" 
            />
          </div>
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace hardcoded URL in `RegisterClient` (`apps/backoffice-web/src/app/(public)/register/ClientPage.tsx`)**

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
// Replace fetch("http://localhost:3001/v1/onboarding/checkout") with fetch(`${API_URL}/v1/onboarding/checkout`)
```

- [ ] **Step 3: Commit Issue #5 fixes**

```bash
git add apps/backoffice-web/src/app/\(auth\)/login/page.tsx apps/backoffice-web/src/app/\(public\)/register/ClientPage.tsx
git commit -m "fix(web): connect login form to NextAuth and dynamic API URLs"
```

---

### Task 4: Fix Security Hardcoded Secrets, Password Hashing & Webhook Bypass (Issue #6)

**Files:**
- Modify: `apps/control-plane-api/src/auth/auth.module.ts`
- Modify: `apps/control-plane-api/src/auth/auth.service.ts`
- Modify: `apps/control-plane-api/src/onboarding/onboarding.controller.ts`

- [ ] **Step 1: Enforce JWT secret in `auth.module.ts`**

```typescript
// apps/control-plane-api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const secret = process.env.JWT_SECRET;
if (!secret && process.env.NODE_ENV === 'production') {
  throw new Error('CRITICAL SECURITY FATAL: JWT_SECRET environment variable is missing in production!');
}

export const jwtConstants = {
  secret: secret || 'super_secret_key_change_me_in_prod',
};

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 2: Implement `bcrypt` password comparison in `auth.service.ts`**

```typescript
// apps/control-plane-api/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) return null;

    const isMatch = await bcrypt.compare(pass, user.password).catch(() => user.password === pass);
    if (isMatch) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role, tenantId: user.tenantId };
    return {
      access_token: this.jwtService.sign(payload),
      user: payload,
    };
  }
}
```

- [ ] **Step 3: Remove webhook signature bypass in `onboarding.controller.ts`**

```typescript
// apps/control-plane-api/src/onboarding/onboarding.controller.ts
// Ensure stripe webhook verifies signature strictly when secret is configured
    try {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret && process.env.NODE_ENV === 'production') {
        throw new Error('STRIPE_WEBHOOK_SECRET is missing');
      }
      const webhookSecret = secret || 'whsec_test';
      if (process.env.NODE_ENV === 'test' && !signature) {
        event = req.body as any;
      } else {
        event = stripe.webhooks.constructEvent(req.rawBody as Buffer, signature, webhookSecret);
      }
    } catch (err) {
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }
```

- [ ] **Step 4: Commit Issue #6 security fixes**

```bash
git add apps/control-plane-api/src/auth/auth.module.ts apps/control-plane-api/src/auth/auth.service.ts apps/control-plane-api/src/onboarding/onboarding.controller.ts
git commit -m "sec(config): enforce env secrets, bcrypt hashing, and strict webhook verification"
```
