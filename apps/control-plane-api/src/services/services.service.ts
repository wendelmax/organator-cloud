import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async createService(
    tenantId: string,
    name: string,
    cloudProvider: string,
    repository: string,
  ) {
    return this.prisma.microservice.create({
      data: {
        tenantId,
        name,
        cloudProvider,
        repository,
      },
    });
  }

  async getServicesByTenant(tenantId: string) {
    return this.prisma.microservice.findMany({
      where: { tenantId },
    });
  }
}
