import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ComponentKey =
  'api' | 'dashboard' | 'provisioning' | 'billing' | 'data-plane';
export type ComponentStatus = 'operational' | 'degraded' | 'outage';

export type ComponentState = {
  component: ComponentKey;
  status: ComponentStatus;
  activeIncidents: number;
};

export type IncidentUpdatePublic = {
  status: string;
  message: string;
  createdAt: Date | string;
};

export type IncidentPublic = {
  id: string;
  title: string;
  severity: 'critical' | 'major' | 'minor';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  component: ComponentKey;
  startedAt: Date | string;
  resolvedAt: Date | string | null;
  updates: IncidentUpdatePublic[];
};

export type StatusResponse = {
  overall: ComponentStatus;
  components: ComponentState[];
  incidents: IncidentPublic[];
};

const COMPONENTS: ComponentKey[] = [
  'api',
  'dashboard',
  'provisioning',
  'billing',
  'data-plane',
];

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(): Promise<StatusResponse> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const incidents = await this.prisma.incident.findMany({
      where: {
        public: true,
        OR: [
          { resolvedAt: null },
          {
            resolvedAt: {
              gte: windowStart,
            },
          },
        ],
      },
      include: {
        updates: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    // Post-filter as defensive measure for test cases
    const filtered = incidents.filter((incident) => {
      if (incident.status !== 'resolved' && incident.resolvedAt === null) {
        return true;
      }
      if (incident.resolvedAt) {
        return incident.resolvedAt >= windowStart;
      }
      if (incident.status !== 'resolved') {
        return true;
      }
      return false;
    });

    const components: ComponentState[] = COMPONENTS.map((component) => {
      const active = filtered.filter(
        (incident) =>
          incident.component === component && incident.status !== 'resolved',
      );
      let status: ComponentStatus = 'operational';
      if (active.some((incident) => incident.severity === 'critical')) {
        status = 'outage';
      } else if (
        active.some(
          (incident) =>
            incident.severity === 'major' || incident.severity === 'minor',
        )
      ) {
        status = 'degraded';
      }
      return {
        component,
        status,
        activeIncidents: active.length,
      };
    });

    let overall: ComponentStatus = 'operational';
    if (components.some((c) => c.status === 'outage')) {
      overall = 'outage';
    } else if (components.some((c) => c.status === 'degraded')) {
      overall = 'degraded';
    }

    const openIncidents = filtered
      .filter((incident) => incident.status !== 'resolved')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const resolvedIncidents = filtered
      .filter((incident) => incident.status === 'resolved')
      .sort((a, b) => {
        const bResolved = b.resolvedAt ? b.resolvedAt.getTime() : 0;
        const aResolved = a.resolvedAt ? a.resolvedAt.getTime() : 0;
        return bResolved - aResolved;
      });

    const ordered = [...openIncidents, ...resolvedIncidents];

    const publicIncidents: IncidentPublic[] = ordered.map((incident) => ({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      component: incident.component,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      updates: (incident.updates || [])
        .filter((update) => update.internal === false)
        .map((update) => ({
          status: update.status,
          message: update.message,
          createdAt: update.createdAt,
        })),
    }));

    return {
      overall,
      components,
      incidents: publicIncidents,
    };
  }
}
