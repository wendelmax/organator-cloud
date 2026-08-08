import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  UnauthorizedException,
  Put,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowPasswordChange } from './allow-password-change.decorator';
import { MfaService } from './mfa.service';
import { AuditService } from '../audit/audit.service';
import { MfaPolicyService } from './mfa-policy.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly auditService: AuditService,
    private readonly mfaPolicyService: MfaPolicyService,
  ) {}

  @Post('login')
  async login(@Req() req: any, @Body() body: Record<string, string>) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      await this.auditService.record({
        actorEmail: body.email ?? null,
        ip: req.ip ?? null,
        action: 'auth.login_failed',
        resourceType: 'Auth',
        resourceId: null,
        changes: { email: body.email ?? null },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    const result = await this.authService.login(user);
    if ('mfa_required' in result && result.mfa_required) {
      return result;
    }
    await this.auditService.record({
      actorId: user.id,
      actorEmail: user.email,
      ip: req.ip ?? null,
      action: 'auth.login_succeeded',
      resourceType: 'Auth',
      resourceId: user.id,
      changes: { role: user.role, tenantId: user.tenantId },
    });
    return result;
  }

  @Post('mfa/verify')
  async mfaVerify(@Req() req: any, @Body() body: { challenge_token: string; code?: string; recovery_code?: string }) {
    const user = await this.mfaService.verifyChallenge(body.challenge_token, body.code, body.recovery_code);
    const result = await this.authService.login({ ...user, mfaBypass: true });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Get('me')
  async me(@Req() req: any) {
    return this.authService.me(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const result = await this.authService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
    await this.auditService.record({
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip ?? null,
      action: 'auth.password_changed',
      resourceType: 'Auth',
      resourceId: req.user.userId,
      changes: {},
    });
    return result;
  }

  // ---- MFA (TOTP app-level) ----

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Get('mfa/status')
  async mfaStatus(@Req() req: any) {
    return this.mfaService.status(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/enroll')
  async mfaEnroll(@Req() req: any) {
    return this.mfaService.enroll(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/enable')
  async mfaEnable(@Req() req: any, @Body() body: { code: string }) {
    const result = await this.mfaService.enable(req.user.userId, body.code);
    await this.auditService.record({
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip ?? null,
      action: 'auth.mfa_enabled',
      resourceType: 'Auth',
      resourceId: req.user.userId,
      changes: { enabled: true },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Post('mfa/disable')
  async mfaDisable(@Req() req: any, @Body() body: { code: string }) {
    const result = await this.mfaService.disable(req.user.userId, body.code);
    await this.auditService.record({
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip ?? null,
      action: 'auth.mfa_disabled',
      resourceType: 'Auth',
      resourceId: req.user.userId,
      changes: { enabled: false },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/recovery-codes')
  async mfaRecoveryCodes(@Req() req: any, @Body() body: { code: string }) {
    return this.mfaService.issueRecoveryCodes(req.user.userId, body.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mfa/policy')
  async mfaPolicy(@Req() req: any) {
    return this.mfaPolicyService.get(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('mfa/policy')
  async updateMfaPolicy(@Req() req: any, @Body() body: { mfaMode: string; requiredRoles?: string[] }) {
    return this.mfaPolicyService.update(req.user.tenantId, req.user, body);
  }
}
