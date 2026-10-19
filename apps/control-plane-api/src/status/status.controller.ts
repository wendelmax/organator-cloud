import { Controller, Get } from '@nestjs/common';
import { StatusService } from './status.service';

@Controller('v1/status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get()
  status() {
    return this.statusService.getStatus();
  }
}
