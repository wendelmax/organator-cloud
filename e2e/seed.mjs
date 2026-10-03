// Seed determinístico para os testes E2E. Idempotente: pode rodar várias vezes.
//
// Executado dentro do container da API (que já tem Prisma Client e bcrypt):
//   docker compose exec -T control-plane-api node --input-type=module < e2e/seed.mjs
import { createRequire } from 'node:module';

// Resolve as dependências como a própria API resolve (a partir do diretório
// atual do container): o Prisma Client vem de @organator/core-models.
const require = createRequire(`${process.cwd()}/`);
const { PrismaClient } = require('@organator/core-models');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

export const E2E_USERS = {
  admin: { email: 'admin@organator.app', password: 'Temp1234!' },
  owner: { email: 'owner@organator.app', password: 'Owner1234!' },
  // Admin da plataforma pronto para uso (sem troca de senha pendente).
  ops: { email: 'ops@organator.app', password: 'Ops12345!' },
  // Usado só no teste de recuperação de senha (troca a própria senha).
  forgetful: { email: 'forgetful@organator.app', password: 'Forget1234!' },
};

const PLANS = [
  { slug: 'free', name: 'Free', price: 0, sortOrder: 0, defaultDataIsolation: 'SHARED' },
  { slug: 'pro', name: 'Pro', price: 4900, sortOrder: 1, defaultDataIsolation: 'SCHEMA' },
  { slug: 'enterprise', name: 'Enterprise', price: 19900, sortOrder: 2, defaultDataIsolation: 'DATABASE' },
];

async function upsertTenant(slug, name, plan) {
  return prisma.tenant.upsert({
    where: { slug },
    create: { slug, name, plan },
    update: { name, plan, state: 'active', status: 'active' },
  });
}

async function upsertUser({ email, password }, data) {
  const hashed = await bcrypt.hash(password, 10);
  const fields = {
    password: hashed,
    failedLoginAttempts: 0,
    loginLockedUntil: null,
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    authProvider: 'credentials',
    ...data,
  };
  return prisma.user.upsert({ where: { email }, create: { email, ...fields }, update: fields });
}

async function main() {
  for (const plan of PLANS) {
    await prisma.billingPlan.upsert({
      where: { slug: plan.slug },
      create: { ...plan, currency: 'usd', cycle: 'monthly', status: 'active' },
      update: { ...plan, status: 'active' },
    });
  }

  const platform = await upsertTenant('platform', 'Platform', 'enterprise');
  // Admin sempre volta a exigir troca de senha (fluxo testado em auth.spec).
  await upsertUser(E2E_USERS.admin, {
    name: 'Platform Admin',
    role: 'PLATFORM_ADMIN',
    tenantId: platform.id,
    mustChangePassword: true,
  });

  await upsertUser(E2E_USERS.ops, {
    name: 'Platform Ops',
    role: 'PLATFORM_ADMIN',
    tenantId: platform.id,
    mustChangePassword: false,
  });

  const acme = await upsertTenant('acme', 'Acme Corp', 'pro');
  const owner = await upsertUser(E2E_USERS.owner, {
    name: 'Acme Owner',
    role: 'OWNER',
    tenantId: acme.id,
    mustChangePassword: false,
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: acme.id, userId: owner.id } },
    create: { tenantId: acme.id, userId: owner.id, role: 'OWNER', status: 'active' },
    update: { role: 'OWNER', status: 'active' },
  });

  const forgetful = await upsertUser(E2E_USERS.forgetful, {
    name: 'Forgetful Member',
    role: 'MEMBER',
    tenantId: acme.id,
    mustChangePassword: false,
  });
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: acme.id, userId: forgetful.id } },
    create: { tenantId: acme.id, userId: forgetful.id, role: 'MEMBER', status: 'active' },
    update: { role: 'MEMBER', status: 'active' },
  });

  // Usuários do seed já aceitaram os termos e a política vigentes (versão padrão
  // da API); contas criadas nos testes passam pela tela de consentimento.
  const seeded = await prisma.user.findMany({
    where: { email: { in: Object.values(E2E_USERS).map((u) => u.email) } },
    select: { id: true },
  });
  for (const { id } of seeded) {
    await prisma.consent.deleteMany({ where: { userId: id } });
    await prisma.consent.createMany({
      data: [
        { userId: id, purpose: 'terms', version: '2026-10' },
        { userId: id, purpose: 'privacy', version: '2026-10' },
      ],
    });
  }

  console.log('[e2e seed] plans, platform admin and acme owner ready');
}

main()
  .catch((err) => {
    console.error('[e2e seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
