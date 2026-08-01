import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLANS = [
  {
    slug: 'free',
    name: 'Free',
    description: 'Para experimentar a plataforma.',
    price: 0,
    currency: 'usd',
    cycle: 'monthly',
    quotas: {
      MICROSERVICE: 2,
      DEPLOYMENT: 5,
      SEATS: 3,
      APIS: 5,
      DOMAINS: 1,
      GB_STORAGE: 1,
    },
    features: { apiKeys: true, auditLog: false, sso: false },
    sortOrder: 1,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Para times em produção.',
    price: 4900,
    currency: 'usd',
    cycle: 'monthly',
    quotas: {
      MICROSERVICE: 20,
      DEPLOYMENT: 100,
      SEATS: 20,
      APIS: 50,
      DOMAINS: 10,
      GB_STORAGE: 100,
    },
    features: { apiKeys: true, auditLog: true, sso: false },
    sortOrder: 2,
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Escala e suporte dedicado.',
    price: 19900,
    currency: 'usd',
    cycle: 'monthly',
    quotas: {
      MICROSERVICE: -1,
      DEPLOYMENT: -1,
      SEATS: -1,
      APIS: -1,
      DOMAINS: -1,
      GB_STORAGE: -1,
    },
    features: { apiKeys: true, auditLog: true, sso: true },
    sortOrder: 3,
  },
];

async function main() {
  for (const plan of PLANS) {
    const data = {
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      cycle: plan.cycle,
      quotas: plan.quotas,
      features: plan.features,
      status: 'active',
      sortOrder: plan.sortOrder,
      stripeProductId: `prod_simulated_${plan.slug}`,
      stripePriceId: `price_simulated_${plan.slug}`,
    };

    await prisma.billingPlan.upsert({
      where: { slug: plan.slug },
      update: data,
      create: { slug: plan.slug, ...data },
    });
    console.log(`[seed] plano "${plan.name}" (${plan.slug}) sincronizado.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('[seed] erro ao semear planos:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
