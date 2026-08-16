import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Observable } from 'rxjs';
import Redis from 'ioredis';

export interface DataIsolationEventPayload {
  deploymentId: string;
  generation: number;
  phase: string;
  status: string;
  timestamp: string;
  message?: string;
}

@Injectable()
export class DataIsolationEventsService {
  private redisHost = process.env.REDIS_HOST || 'localhost';
  private redisPort = Number(process.env.REDIS_PORT) || 6379;

  constructor(private readonly prisma: PrismaService) {}

  async stream(input: { tenantId: string; deploymentId: string }): Promise<Observable<{ data: DataIsolationEventPayload }>> {
    // Ownership check: query Deployment by id and tenantId
    const deployment = await this.prisma.deployment.findFirst({
      where: {
        id: input.deploymentId,
        tenantId: input.tenantId,
      },
    });

    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }

    const channel = `data_isolation:${input.tenantId}:${input.deploymentId}`;

    return new Observable((subscriber) => {
      const redis = new Redis({
        host: this.redisHost,
        port: this.redisPort,
      });

      redis.subscribe(channel, (err) => {
        if (err) {
          subscriber.error(err);
        }
      });

      const messageHandler = (ch: string, message: string) => {
        if (ch === channel) {
          try {
            const parsed = JSON.parse(message);
            subscriber.next({ data: parsed });
          } catch {
            // Ignore malformed messages
          }
        }
      };

      redis.on('message', messageHandler);

      // Heartbeat interval (15s)
      const heartbeat = setInterval(() => {
        subscriber.next({
          data: {
            deploymentId: input.deploymentId,
            generation: 0,
            phase: 'HEARTBEAT',
            status: 'PING',
            timestamp: new Date().toISOString(),
          },
        });
      }, 15000);

      return () => {
        clearInterval(heartbeat);
        redis.off('message', messageHandler);
        redis.unsubscribe(channel).catch(() => {});
        redis.quit().catch(() => {});
      };
    });
  }
}
