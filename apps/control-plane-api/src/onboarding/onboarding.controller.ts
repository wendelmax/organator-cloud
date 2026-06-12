import { Controller, Post, Body } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TenantsService } from '../tenants/tenants.service';

@Controller('webhooks/stripe')
export class OnboardingController {
  constructor(
    private readonly tenantsService: TenantsService,
    @InjectQueue('provisioner') private readonly provisionerQueue: Queue
  ) {}

  @Post()
  async handleStripeWebhook(@Body() event: any) {
    if (event.type === 'checkout.session.completed') {
      const { metadata, customer_email } = event.data.object;
      
      console.log(`[Webhook] Pagamento recebido para ${metadata.tenantName}`);
      
      const tenant = await this.tenantsService.createTenant(
        metadata.tenantName,
        metadata.plan,
        customer_email
      );

      console.log(`[Provisioner] Disparando fila para criar banco isolado para o tenant ${tenant.id}...`);
      
      await this.provisionerQueue.add('deploy-tenant-infra', {
        tenantId: tenant.id,
        plan: tenant.plan,
        action: 'INITIAL_PROVISIONING'
      });
      
      return { received: true, tenantId: tenant.id };
    }

    return { received: true };
  }
}
