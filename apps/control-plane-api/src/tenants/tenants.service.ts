import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async getMembers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async addMember(
    tenantId: string,
    email: string,
    name?: string,
    role: string = 'MEMBER',
    password?: string,
  ) {
    const rawPassword = password || 'changeme123';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    return this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: name || null,
        role: role || 'MEMBER',
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async updateMemberRole(tenantId: string, userId: string, role: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException('Member not found in tenant');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async removeMember(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException('Member not found in tenant');
    }
    return this.prisma.user.delete({
      where: { id: userId },
    });
  }
}

