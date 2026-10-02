import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController — routes', () => {
  let auth: any;
  let mfa: any;
  let audit: any;
  let mfaPolicy: any;
  let passwordReset: any;
  let controller: AuthController;
  // Formato real de req.user produzido por JwtStrategy/OidcStrategy (não há `sub`).
  const req = {
    ip: '10.0.0.1',
    headers: { 'user-agent': 'jest' },
    user: {
      userId: 'u1',
      email: 'o@acme.com',
      role: 'OWNER',
      tenantId: 't1',
      sessionId: 'sess-1',
    },
  };

  beforeEach(() => {
    auth = {
      validateUser: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      listSessions: jest.fn(),
      revokeSession: jest.fn().mockResolvedValue({ revoked: true }),
      revokeOtherSessions: jest.fn().mockResolvedValue({ revoked: 2 }),
      switchTenant: jest.fn(),
      me: jest.fn(),
      changePassword: jest.fn().mockResolvedValue({ success: true }),
    };
    mfa = {
      verifyChallenge: jest.fn(),
      status: jest.fn(),
      enroll: jest.fn(),
      enable: jest.fn().mockResolvedValue({ enabled: true }),
      disable: jest.fn().mockResolvedValue({ enabled: false }),
      issueRecoveryCodes: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    mfaPolicy = { get: jest.fn(), update: jest.fn() };
    passwordReset = {
      requestReset: jest.fn().mockResolvedValue(undefined),
      resetPassword: jest.fn().mockResolvedValue({ success: true }),
    };
    controller = new AuthController(auth, mfa, audit, mfaPolicy, passwordReset);
  });

  describe('password recovery (public routes)', () => {
    it('answers the same way whether or not the e-mail exists', async () => {
      await expect(
        controller.forgotPassword(req, { email: 'o@acme.com' }),
      ).resolves.toEqual({ accepted: true });
      expect(passwordReset.requestReset).toHaveBeenCalledWith(
        'o@acme.com',
        '10.0.0.1',
      );
      await expect(controller.forgotPassword(req, {})).resolves.toEqual({
        accepted: true,
      });
    });

    it('resets the password with the e-mailed token', async () => {
      await expect(
        controller.resetPassword({ token: 'tok', password: 'NewPass123' }),
      ).resolves.toEqual({ success: true });
      expect(passwordReset.resetPassword).toHaveBeenCalledWith(
        'tok',
        'NewPass123',
      );
    });
  });

  describe('login', () => {
    it('audits failed logins and returns 401', async () => {
      auth.validateUser.mockResolvedValue(null);
      await expect(
        controller.login(req, { email: 'x@y.z', password: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          actorEmail: 'x@y.z',
          ip: '10.0.0.1',
        }),
      );
      expect(auth.login).not.toHaveBeenCalled();
    });

    it('passes ip and user agent to the session and audits success', async () => {
      const user = {
        id: 'u1',
        email: 'o@acme.com',
        role: 'OWNER',
        tenantId: 't1',
      };
      auth.validateUser.mockResolvedValue(user);
      auth.login.mockResolvedValue({ access_token: 'a' });

      await expect(
        controller.login(req, { email: user.email, password: 'p' }),
      ).resolves.toEqual({ access_token: 'a' });
      expect(auth.login).toHaveBeenCalledWith(user, {
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_succeeded',
          actorId: 'u1',
        }),
      );
    });

    it('does not audit success while an MFA challenge is pending', async () => {
      auth.validateUser.mockResolvedValue({ id: 'u1' });
      auth.login.mockResolvedValue({
        mfa_required: true,
        challenge_token: 'c',
      });
      await expect(
        controller.login(req, { email: 'e', password: 'p' }),
      ).resolves.toMatchObject({ mfa_required: true });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('completes MFA login bypassing a second challenge', async () => {
    mfa.verifyChallenge.mockResolvedValue({ id: 'u1', email: 'o@acme.com' });
    auth.login.mockResolvedValue({ access_token: 'a' });
    await controller.mfaVerify(req, { challenge_token: 'c', code: '123456' });
    expect(mfa.verifyChallenge).toHaveBeenCalledWith('c', '123456', undefined);
    expect(auth.login).toHaveBeenCalledWith({
      id: 'u1',
      email: 'o@acme.com',
      mfaBypass: true,
    });
  });

  it('delegates refresh, sessions, switch-tenant and me to the current user', async () => {
    controller.refresh({ refresh_token: 'r' });
    controller.sessions(req);
    controller.switchTenant(req, { tenantId: 't2' });
    await controller.me(req);
    expect(auth.refresh).toHaveBeenCalledWith('r');
    expect(auth.listSessions).toHaveBeenCalledWith('u1');
    expect(auth.switchTenant).toHaveBeenCalledWith('u1', 't2');
    expect(auth.me).toHaveBeenCalledWith('u1');
  });

  it('audits session revocations', async () => {
    await controller.revokeSession(req, 'sess-9');
    await controller.revokeOtherSessions(req);
    expect(auth.revokeOtherSessions).toHaveBeenCalledWith('u1', 'sess-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.session_revoked',
        resourceId: 'sess-9',
        actorId: 'u1',
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.sessions_revoked',
        changes: { revoked: 2 },
      }),
    );
  });

  describe('audit trail records the real actor', () => {
    it('change-password keeps the current session and audits with actorId', async () => {
      await controller.changePassword(req, {
        currentPassword: 'a',
        newPassword: 'b',
      });
      expect(auth.changePassword).toHaveBeenCalledWith(
        'u1',
        'a',
        'b',
        'sess-1',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.password_changed',
          actorId: 'u1',
          actorEmail: 'o@acme.com',
        }),
      );
    });

    it('mfa/enable revokes other sessions and audits with actorId', async () => {
      await controller.mfaEnable(req, { code: '123456' });
      expect(mfa.enable).toHaveBeenCalledWith('u1', '123456');
      expect(auth.revokeOtherSessions).toHaveBeenCalledWith('u1', 'sess-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.mfa_enabled', actorId: 'u1' }),
      );
    });

    it('mfa/disable audits with actorId', async () => {
      await controller.mfaDisable(req, { code: '123456' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.mfa_disabled', actorId: 'u1' }),
      );
    });

    it('never records an undefined actor', async () => {
      await controller.changePassword(req, {
        currentPassword: 'a',
        newPassword: 'b',
      });
      await controller.mfaEnable(req, { code: '1' });
      await controller.mfaDisable(req, { code: '1' });
      for (const [entry] of audit.record.mock.calls)
        expect(entry.actorId).toBe('u1');
    });
  });

  it('delegates MFA status/enroll/recovery/policy routes', async () => {
    await controller.mfaStatus(req);
    await controller.mfaEnroll(req);
    await controller.mfaRecoveryCodes(req, { code: '1' });
    await controller.mfaPolicy(req);
    await controller.updateMfaPolicy(req, { mfaMode: 'required_for_all' });
    expect(mfa.status).toHaveBeenCalledWith('u1');
    expect(mfa.enroll).toHaveBeenCalledWith('u1');
    expect(mfa.issueRecoveryCodes).toHaveBeenCalledWith('u1', '1');
    expect(mfaPolicy.get).toHaveBeenCalledWith('t1');
    expect(mfaPolicy.update).toHaveBeenCalledWith('t1', req.user, {
      mfaMode: 'required_for_all',
    });
  });

  it('keeps login, refresh and mfa/verify public and everything else behind JwtAuthGuard', () => {
    const p = AuthController.prototype as any;
    for (const m of [
      'login',
      'refresh',
      'mfaVerify',
      'forgotPassword',
      'resetPassword',
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, p[m])).toBeUndefined();
    }
    for (const m of [
      'sessions',
      'revokeSession',
      'revokeOtherSessions',
      'switchTenant',
      'me',
      'changePassword',
      'mfaStatus',
      'mfaEnroll',
      'mfaEnable',
      'mfaDisable',
      'mfaRecoveryCodes',
      'mfaPolicy',
      'updateMfaPolicy',
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, p[m])).toEqual([
        JwtAuthGuard,
      ]);
    }
  });

  it('only exempts account-recovery routes from the forced password change', () => {
    const p = AuthController.prototype as any;
    const allowed = [
      'me',
      'changePassword',
      'mfaStatus',
      'mfaEnroll',
      'mfaEnable',
      'mfaDisable',
    ];
    for (const m of allowed)
      expect(Reflect.getMetadata('allowPasswordChange', p[m])).toBe(true);
    for (const m of [
      'sessions',
      'switchTenant',
      'mfaRecoveryCodes',
      'updateMfaPolicy',
    ]) {
      expect(Reflect.getMetadata('allowPasswordChange', p[m])).toBeUndefined();
    }
  });
});
