import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async createService(tenantId: string, name: string, provider: 'VERCEL' | 'AWS' | 'DOCKER_VPS', repositoryUrl: string) {
    return this.prisma.service.create({
      data: {
        tenantId,
        name,
        provider,
        repositoryUrl,
        status: 'PENDING_DEPLOY',
      },
    });
  }

  async getServicesByTenant(tenantId: string) {
    return this.prisma.service.findMany({
      where: { tenantId },
    });
  }
}
