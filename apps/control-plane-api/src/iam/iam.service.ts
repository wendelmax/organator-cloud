import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integra o Organator com o Identity Provider (VoidAuth):
 * - cria/garante o grupo por tenant (tenant-{slug})
 * - (opcional) dispara convite no VoidAuth quando VOIDAUTH_ADMIN_TOKEN está configurado
 * - mapeia usuários OIDC pelo e-mail/sub
 */
@Injectable()
export class IamService {
  private readonly logger = new Logger(IamService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureTenantGroup(tenantId: string, slug: string): Promise<string> {
    const groupName = `tenant-${slug}`;
    const group = await this.prisma.iamGroup.upsert({
      where: { tenantId_name: { tenantId, name: groupName } },
      create: { tenantId, name: groupName },
      update: {},
    });
    return group.name;
  }

  /**
   * Após o pagamento, garante o grupo do tenant e, se configurado,
   * envia convite do VoidAuth para o e-mail do OWNER.
   */
  async linkOwnerAfterCheckout(
    tenantId: string,
    tenantSlug: string,
    ownerEmail: string,
  ) {
    const groupName = await this.ensureTenantGroup(tenantId, tenantSlug);

    const baseUrl = process.env.VOIDAUTH_URL;
    const adminToken = process.env.VOIDAUTH_ADMIN_TOKEN;
    if (baseUrl && adminToken) {
      try {
        await this.inviteUser(baseUrl, adminToken, ownerEmail, groupName);
      } catch (err: any) {
        this.logger.warn(
          `[IAM] Falha ao convidar ${ownerEmail} no VoidAuth (continuando sem convite): ${err.message}`,
        );
      }
    } else {
      this.logger.log(
        '[IAM] VOIDAUTH_URL/VOIDAUTH_ADMIN_TOKEN não configurados — convite no VoidAuth pulado (self-registration via OIDC).',
      );
    }

    return { group: groupName };
  }

  private async inviteUser(
    baseUrl: string,
    token: string,
    email: string,
    group: string,
  ) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, group }),
    });
    if (!res.ok) {
      throw new Error(`VoidAuth invite failed: HTTP ${res.status}`);
    }
    return res.json();
  }
}
