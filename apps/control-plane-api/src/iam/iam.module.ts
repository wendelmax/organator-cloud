import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { IamService } from './iam.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [AdminBootstrapService, IamService, PrismaService],
  exports: [IamService],
})
export class IamModule {}
