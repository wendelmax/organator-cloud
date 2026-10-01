import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { IamService } from './iam.service';

@Module({
  providers: [AdminBootstrapService, IamService],
  exports: [IamService],
})
export class IamModule {}
