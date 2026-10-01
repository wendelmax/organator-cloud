import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

/** Liveness fica em GET /health (AppController), sem dependências externas. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Readiness: só recebe tráfego quando Postgres e Redis respondem. */
  @Get('ready')
  async ready() {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ready') {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
