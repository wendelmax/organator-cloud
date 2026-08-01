import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(name: string, plan?: string, adminEmail?: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    let admin: { id: string } | null = null;
    if (adminEmail) {
      admin = await this.prisma.user.findUnique({ where: { email: adminEmail } });
    }

    return this.prisma.tenant.create({
      data: {
        name,
        slug,
        plan: plan || 'free',
        stripeId: `cus_simulated_${Date.now()}`,
        users: admin
          ? { connect: { id: admin.id } }
          : adminEmail
            ? {
                create: [
                  {
                    email: adminEmail,
                    name: 'Admin',
                    password: await bcrypt.hash(crypto.randomBytes(16).toString('base64url'), 10),
                    role: 'OWNER',
                    mustChangePassword: true,
                  },
                ],
              }
            : undefined,
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
    const rawPassword =
      password || crypto.randomBytes(16).toString('base64url');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    return this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: name || null,
        role: role || 'MEMBER',
        password: hashedPassword,
        mustChangePassword: true,
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
