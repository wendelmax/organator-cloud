import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

export interface DependencyCheck {
  ok: boolean;
  latencyMs: number;
}

export interface Readiness {
  status: 'ready' | 'not_ready';
  checks: { database: DependencyCheck; redis: DependencyCheck };
}

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redisClient().ping()),
    ]);
    return {
      status: database.ok && redis.ok ? 'ready' : 'not_ready',
      checks: { database, redis },
    };
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private redisClient(): Redis {
    this.redis ??= new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    return this.redis;
  }

  // Detalhes do erro não são expostos: o endpoint é público para os probes.
  private async check(probe: () => Promise<unknown>): Promise<DependencyCheck> {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { ok: true, latencyMs: Date.now() - started };
    } catch {
      return { ok: false, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}
