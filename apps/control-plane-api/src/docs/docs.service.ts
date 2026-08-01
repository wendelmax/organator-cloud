import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDoc(data: { microserviceId: string; title: string; version: string; openApiSpec: string; isPublic?: boolean }) {
    return this.prisma.apiDoc.create({
      data: {
        microserviceId: data.microserviceId,
        title: data.title,
        version: data.version,
        openApiSpec: data.openApiSpec,
        isPublic: data.isPublic ?? false,
      },
    });
  }

  async getDocsByService(microserviceId: string) {
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

  async toggleVisibility(id: string, isPublic: boolean) {
    const doc = await this.prisma.apiDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`ApiDoc with ID ${id} not found`);
    return this.prisma.apiDoc.update({
      where: { id },
      data: { isPublic },
    });
  }
}
