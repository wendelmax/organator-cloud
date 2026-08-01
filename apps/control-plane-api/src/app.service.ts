import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getServiceInfo() {
    return {
      service: 'organator-control-plane-api',
      version: '1.3.0',
      status: 'healthy',
      uptime: process.uptime(),
      endpoints: {
        tenants: '/v1/tenants',
        services: '/v1/services',
        docs: '/v1/docs',
        auth: '/v1/auth/login',
        billing: '/v1/billing',
      },
    };
  }
}
