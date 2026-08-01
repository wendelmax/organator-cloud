import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || 'admin@organator.app';
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Temp1234!';
const FORCE = process.env.PLATFORM_ADMIN_FORCE === 'true';

async function main() {
  const password = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const tenant =
    (await prisma.tenant.findUnique({ where: { slug: 'platform' } })) ||
    (await prisma.tenant.create({
      data: { name: 'Platform', slug: 'platform', plan: 'enterprise' },
    }));

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing && FORCE) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password,
        mustChangePassword: true,
        authProvider: 'credentials',
        tenantId: tenant.id,
        role: 'PLATFORM_ADMIN',
      },
    });
    console.log(`[seed] admin ${ADMIN_EMAIL} atualizado (senha resetada).`);
  } else if (!existing) {
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        password,
        name: 'Platform Admin',
        role: 'PLATFORM_ADMIN',
        tenantId: tenant.id,
        mustChangePassword: true,
        authProvider: 'credentials',
      },
    });
    console.log(`[seed] admin ${ADMIN_EMAIL} criado.`);
  } else {
    console.log(`[seed] admin ${ADMIN_EMAIL} já existe (use PLATFORM_ADMIN_FORCE=true para resetar).`);
  }

  const count = await prisma.user.count();
  console.log(`[seed] total de usuários no banco: ${count}`);

  // Usuário de teste (dashboard) sem troca obrigatória de senha
  const ownerEmail = process.env.TEST_OWNER_EMAIL || 'owner@organator.app';
  const ownerPassword = await bcrypt.hash(process.env.TEST_OWNER_PASSWORD || 'Owner1234!', 10);
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    await prisma.user.create({
      data: {
        email: ownerEmail,
        password: ownerPassword,
        name: 'Owner Test',
        role: 'PLATFORM_ADMIN',
        tenantId: tenant.id,
        mustChangePassword: false,
        authProvider: 'credentials',
      },
    });
    console.log(`[seed] owner de teste ${ownerEmail} criado.`);
  } else {
    console.log(`[seed] owner de teste ${ownerEmail} já existe.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
