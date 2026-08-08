import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { AuditService } from '../audit/audit.service';
import { MfaPolicyService } from './mfa-policy.service';

describe('AuthController', () => {
  let controller: AuthController;
  let audit: any;

  const mockAuthService = {
    validateUser: jest.fn(),
    login: jest.fn(),
    me: jest.fn(),
    changePassword: jest.fn(),
  };

  const mockMfaService = {
    status: jest.fn(),
    enroll: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    verifyChallenge: jest.fn(),
    issueRecoveryCodes: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: MfaService, useValue: mockMfaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: MfaPolicyService, useValue: { get: jest.fn(), update: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    audit = mockAuditService;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('records auth.login_failed with attempted email and ip on failure', async () => {
      mockAuthService.validateUser.mockResolvedValue(null);
      const req = { ip: '10.0.0.1' };

      await expect(
        controller.login(req, { email: 'ghost@organator.app', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(audit.record).toHaveBeenCalledWith({
        actorEmail: 'ghost@organator.app',
        ip: '10.0.0.1',
        action: 'auth.login_failed',
        resourceType: 'Auth',
        resourceId: null,
        changes: { email: 'ghost@organator.app' },
      });
    });

    it('records auth.login_succeeded with actor info on success', async () => {
      const user = {
        id: 'user-1',
        email: 'admin@organator.app',
        role: 'PLATFORM_ADMIN',
        tenantId: 'tenant-1',
      };
      mockAuthService.validateUser.mockResolvedValue(user);
      mockAuthService.login.mockResolvedValue({ access_token: 'jwt' });
      const req = { ip: '10.0.0.1' };

      const result = await controller.login(req, {
        email: 'admin@organator.app',
        password: 'secret',
      });

      expect(result).toEqual({ access_token: 'jwt' });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'user-1',
        actorEmail: 'admin@organator.app',
        ip: '10.0.0.1',
        action: 'auth.login_succeeded',
        resourceType: 'Auth',
        resourceId: 'user-1',
        changes: { role: 'PLATFORM_ADMIN', tenantId: 'tenant-1' },
      });
    });
  });
});
