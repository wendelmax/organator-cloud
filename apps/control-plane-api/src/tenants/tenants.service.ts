import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(name: string, plan: string, adminEmail: string) {
    return this.prisma.tenant.create({
      data: {
        name,
        plan,
        stripeCustomerId: `cus_simulated_${Date.now()}`,
        status: 'ACTIVE',
        users: {
          create: {
            email: adminEmail,
            name: 'Admin',
            role: 'OWNER',
          }
        }
      },
    });
  }

  async getTenants() {
    return this.prisma.tenant.findMany({
      include: {
        users: true,
        services: true,
      }
    });
  }
}
