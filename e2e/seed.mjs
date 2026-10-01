// Seed determinístico para os testes E2E. Idempotente: pode rodar várias vezes.
//
// Executado dentro do container da API (que já tem Prisma Client e bcrypt):
//   docker compose exec -T control-plane-api node --input-type=module < e2e/seed.mjs
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const E2E_USERS = {
  admin: { email: 'admin@organator.app', password: 'Temp1234!' },
  owner: { email: 'owner@organator.app', password: 'Owner1234!' },
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

  console.log('[e2e seed] plans, platform admin and acme owner ready');
}

main()
  .catch((err) => {
    console.error('[e2e seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
