import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDoc(
    data: {
      microserviceId: string;
      title: string;
      version: string;
      openApiSpec: string;
      isPublic?: boolean;
    },
    tenantId: string,
    // null = pode anexar a serviço de qualquer tenant (admin da plataforma).
    scope: string | null = tenantId,
  ) {
    let microservice = await this.prisma.microservice.findFirst({
      where: {
        id: data.microserviceId,
        ...(scope !== null ? { tenantId: scope } : {}),
      },
    });
    if (!microservice) {
      microservice = await this.prisma.microservice.findFirst({
        where: { tenantId, name: data.microserviceId },
      });
    }
    if (!microservice) {
      microservice = await this.prisma.microservice.create({
        data: {
          tenantId,
          name: data.microserviceId,
          cloudProvider: 'MANUAL',
        },
      });
    }
    return this.prisma.apiDoc.create({
      data: {
        microserviceId: microservice.id,
        title: data.title,
        version: data.version,
        openApiSpec: data.openApiSpec,
        isPublic: data.isPublic ?? false,
      },
    });
  }

  /** Docs (inclusive privados) de um serviço visível no escopo; senão 404. */
  async getDocsByService(microserviceId: string, scope: string | null = null) {
    if (scope !== null) {
      const service = await this.prisma.microservice.findFirst({
        where: { id: microserviceId, tenantId: scope },
      });
      if (!service) throw new NotFoundException('Service not found');
    }
    return this.prisma.apiDoc.findMany({
      where: { microserviceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllPublicDocs() {
    return this.prisma.apiDoc.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleVisibility(
    id: string,
    isPublic: boolean,
    scope: string | null = null,
  ) {
    const doc = await this.prisma.apiDoc.findUnique({
      where: { id },
      include: { microservice: { select: { tenantId: true } } },
    });
    // De outro tenant: 404, como se não existisse.
    if (!doc || (scope !== null && doc.microservice?.tenantId !== scope)) {
      throw new NotFoundException(`ApiDoc with ID ${id} not found`);
    }
    return this.prisma.apiDoc.update({
      where: { id },
      data: { isPublic },
    });
  }
}
