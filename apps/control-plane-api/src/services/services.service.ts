import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Observable } from 'rxjs';
import Redis from 'ioredis';

@Injectable()
export class ServicesService {
  private redisHost = process.env.REDIS_HOST || 'localhost';
  private redisPort = Number(process.env.REDIS_PORT) || 6379;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue('provisioner')
    private readonly provisionerQueue?: Queue,
  ) {}

  streamDeploymentLogs(deploymentId: string): Observable<{ data: string }> {
    return new Observable<{ data: string }>((subscriber) => {
      const subscriberRedis = new Redis({
        host: this.redisHost,
        port: this.redisPort,
      });

      const channel = `deploy_logs:${deploymentId}`;

      subscriberRedis.subscribe(channel, (err) => {
        if (err) {
          console.error(
            `[Redis Sub Error] Failed to subscribe to ${channel}:`,
            err,
          );
        }
      });

      const messageHandler = (ch: string, message: string) => {
        if (ch === channel) {
          subscriber.next({ data: message });
        }
      };

      subscriberRedis.on('message', messageHandler);

      return () => {
        subscriberRedis.off('message', messageHandler);
        subscriberRedis.unsubscribe(channel).catch(() => {});
        subscriberRedis.quit().catch(() => {});
      };
    });
  }

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

  async getDeploymentsByService(serviceId: string) {
    return this.prisma.deployment.findMany({
      where: { microserviceId: serviceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async triggerDeploy(serviceId: string) {
    const service = await this.prisma.microservice.findUnique({
      where: { id: serviceId },
    });
    if (!service) throw new Error('Service not found');

    const deployment = await this.prisma.deployment.create({
      data: {
        microserviceId: serviceId,
        status: 'PENDING',
        logs: 'Aguardando worker iniciar o deploy...\n',
      },
    });

    if (this.provisionerQueue) {
      try {
        await this.provisionerQueue.add('deploy-microservice', {
          serviceId: service.id,
          provider: service.cloudProvider,
          repo: service.repository,
          deploymentId: deployment.id,
        });
      } catch (err) {
        console.warn('Could not trigger BullMQ job:', err);
      }
    }

    return deployment;
  }
}
