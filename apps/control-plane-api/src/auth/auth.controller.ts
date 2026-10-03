import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  UnauthorizedException,
  Put,
  Param,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowPasswordChange } from './allow-password-change.decorator';
import { MfaService } from './mfa.service';
import { AuditService } from '../audit/audit.service';
import { MfaPolicyService } from './mfa-policy.service';
import { PasswordResetService } from './password-reset.service';
import { ImpersonationService } from './impersonation.service';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly auditService: AuditService,
    private readonly mfaPolicyService: MfaPolicyService,
    private readonly passwordReset: PasswordResetService,
    private readonly impersonation: ImpersonationService,
  ) {}

  /** Suporte: assume a sessão de um usuário por até 30 min (auditado). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PLATFORM_ADMIN')
  @Post('impersonate')
  impersonate(
    @Req() req: any,
    @Body() body: { userId?: string; reason?: string },
  ) {
    return this.impersonation.start(req.user, body ?? {}, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('impersonate/stop')
  stopImpersonation(@Req() req: any) {
    return this.impersonation.stop(req.user);
  }

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
    const result = await this.authService.login(user, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
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

  @Post('refresh')
  refresh(@Body() body: { refresh_token: string }) {
    return this.authService.refresh(body.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@Req() req: any) {
    return this.authService.listSessions(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  async revokeSession(@Req() req: any, @Param('id') id: string) {
    const result = await this.authService.revokeSession(req.user.userId, id);
    await this.auditService.record({
      actorId: req.user.userId,
      action: 'auth.session_revoked',
      resourceType: 'UserSession',
      resourceId: id,
    });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  async revokeOtherSessions(@Req() req: any) {
    const result = await this.authService.revokeOtherSessions(
      req.user.userId,
      req.user.sessionId,
    );
    await this.auditService.record({
      actorId: req.user.userId,
      action: 'auth.sessions_revoked',
      resourceType: 'UserSession',
      changes: result,
    });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch-tenant')
  switchTenant(@Req() req: any, @Body() body: { tenantId: string }) {
    return this.authService.switchTenant(req.user.userId, body.tenantId);
  }

  @Post('mfa/verify')
  async mfaVerify(
    @Req() req: any,
    @Body()
    body: { challenge_token: string; code?: string; recovery_code?: string },
  ) {
    const user = await this.mfaService.verifyChallenge(
      body.challenge_token,
      body.code,
      body.recovery_code,
    );
    const result = await this.authService.login({ ...user, mfaBypass: true });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChange()
  @Get('me')
  async me(@Req() req: any) {
    const me = await this.authService.me(req.user.userId);
    // Sessão de suporte: o painel mostra quem está acessando como o usuário.
    return { ...me, impersonatedBy: req.user.impersonatorEmail ?? null };
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
      req.user.sessionId,
    );
    await this.auditService.record({
      actorId: req.user?.userId,
      actorEmail: req.user?.email,
      ip: req.ip ?? null,
      action: 'auth.password_changed',
      resourceType: 'Auth',
      resourceId: req.user.userId,
      changes: {},
    });
    return result;
  }

  /** Sempre 202: a resposta não revela se o e-mail tem conta. */
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Req() req: any, @Body() body: { email?: string }) {
    await this.passwordReset.requestReset(body?.email ?? '', req.ip);
    return { accepted: true };
  }

  @Post('password/reset')
  resetPassword(@Body() body: { token?: string; password?: string }) {
    return this.passwordReset.resetPassword(
      body?.token ?? '',
      body?.password ?? '',
    );
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
    await this.authService.revokeOtherSessions(
      req.user.userId,
      req.user.sessionId,
    );
    await this.auditService.record({
      actorId: req.user?.userId,
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
      actorId: req.user?.userId,
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
  async updateMfaPolicy(
    @Req() req: any,
    @Body() body: { mfaMode: string; requiredRoles?: string[] },
  ) {
    return this.mfaPolicyService.update(req.user.tenantId, req.user, body);
  }
}
