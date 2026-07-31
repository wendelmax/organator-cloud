import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(name: string, plan: string, adminEmail: string) {
    const hashedPassword = await bcrypt.hash('hashedpassword123', 10);
    return this.prisma.tenant.create({
      data: {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        plan,
        stripeId: `cus_simulated_${Date.now()}`,
        users: {
          create: [
            {
              email: adminEmail,
              name: 'Admin',
              password: hashedPassword,
              role: 'OWNER',
            },
          ],
        },
      },
    });
  }

  async getTenants() {
    return this.prisma.tenant.findMany({
      include: {
        users: true,
        microservices: true,
      },
    });
  }
}
