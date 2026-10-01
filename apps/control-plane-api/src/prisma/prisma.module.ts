import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Um único PrismaClient (e pool de conexões) para toda a aplicação. Declarar
 * PrismaService nos providers de cada módulo criava um cliente por módulo e
 * multiplicava as conexões abertas no Postgres.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
