import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import {
  PasswordPolicyService,
  type PasswordPolicyRules,
} from './password-policy.service';

/** Política de senha do tenant ativo da sessão (#104). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/tenants/current/password-policy')
export class PasswordPolicyController {
  constructor(private readonly policies: PasswordPolicyService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  get(@Req() req: any) {
    return this.policies.getPolicy(req.user.tenantId);
  }

  // Afrouxar a política é decisão do dono do tenant.
  @Put()
  @Roles('OWNER')
  update(@Req() req: any, @Body() body: Partial<PasswordPolicyRules>) {
    return this.policies.updatePolicy(
      req.user.tenantId,
      body ?? {},
      req.user.userId,
    );
  }
}
