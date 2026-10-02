import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';

/**
 * Membros de um tenant chegam por dois caminhos: tenant de origem
 * (user.tenantId, papel em user.role) ou membership ativa (convite, papel em
 * membership.role). Listagem, troca de papel e remoção tratam os dois.
 */
describe('TenantsService — members', () => {
  const T = 'tenant-1';
  const homeUser = {
    id: 'u-home',
    email: 'home@acme.com',
    name: 'Home',
    tenantId: T,
    role: 'MEMBER',
    createdAt: new Date('2026-01-01'),
  };
  const invitedUser = {
    id: 'u-invited',
    email: 'guest@other.com',
    name: 'Guest',
    tenantId: 'tenant-other',
    role: 'OWNER', // papel no tenant de origem dele, não neste
    createdAt: new Date('2026-01-02'),
  };
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: TenantsService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...homeUser, ...data }),
        ),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
      },
      tenantMembership: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      userSession: { updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
    audit = { record: jest.fn() };
    service = new TenantsService(
      prisma,
      {} as never,
      audit as never,
      {} as never,
    );
  });

  const asMember = (user: any, membership: any = null) => {
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.tenantMembership.findUnique.mockResolvedValue(membership);
  };

  describe('getMembers', () => {
    it('lists home users and invited members with the role they have here', async () => {
      prisma.user.findMany.mockResolvedValue([
        { ...homeUser, memberships: [] },
        { ...invitedUser, memberships: [{ role: 'DEVELOPER' }] },
      ]);

      const members = await service.getMembers(T);

      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { tenantId: T },
          { memberships: { some: { tenantId: T, status: 'active' } } },
        ],
      });
      expect(members).toEqual([
        {
          id: 'u-home',
          email: 'home@acme.com',
          name: 'Home',
          role: 'MEMBER',
          createdAt: homeUser.createdAt,
        },
        {
          id: 'u-invited',
          email: 'guest@other.com',
          name: 'Guest',
          role: 'DEVELOPER',
          createdAt: invitedUser.createdAt,
        },
      ]);
      // Sem campos sensíveis na resposta.
      expect(Object.keys(members[0])).not.toContain('password');
    });
  });

  describe('updateMemberRole', () => {
    it("changes an invited member's role in the membership, not in their home tenant", async () => {
      asMember(invitedUser, { id: 'm-1', status: 'active', role: 'MEMBER' });

      const result = await service.updateMemberRole(
        T,
        'u-invited',
        'DEVELOPER',
        {
          actorRole: 'OWNER',
        },
      );

      expect(prisma.tenantMembership.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { role: 'DEVELOPER' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.role).toBe('DEVELOPER');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.member.role_changed',
          changes: expect.objectContaining({ from: 'MEMBER', to: 'DEVELOPER' }),
        }),
      );
    });

    it('changes a home user role and keeps the membership in sync', async () => {
      asMember(homeUser, { id: 'm-home', status: 'active', role: 'MEMBER' });

      await service.updateMemberRole(T, 'u-home', 'ADMIN', {
        actorRole: 'OWNER',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-home' },
          data: { role: 'ADMIN' },
        }),
      );
      expect(prisma.tenantMembership.update).toHaveBeenCalledWith({
        where: { id: 'm-home' },
        data: { role: 'ADMIN' },
      });
    });

    it('uses the role in this tenant for the escalation check', async () => {
      // OWNER no tenant de origem, MEMBER aqui: um ADMIN daqui pode alterá-lo.
      asMember(invitedUser, { id: 'm-1', status: 'active', role: 'MEMBER' });
      await expect(
        service.updateMemberRole(T, 'u-invited', 'DEVELOPER', {
          actorRole: 'ADMIN',
        }),
      ).resolves.toBeDefined();

      asMember(homeUser, null);
      await expect(
        service.updateMemberRole(T, 'u-home', 'OWNER', { actorRole: 'ADMIN' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      ['ADMIN', 'MEMBER', 'OWNER'],
      ['ADMIN', 'OWNER', 'MEMBER'],
      ['OWNER', 'MEMBER', 'NOT_A_ROLE'],
    ])('%s cannot change a %s to %s', async (actorRole, current, role) => {
      asMember({ ...homeUser, role: current }, null);
      await expect(
        service.updateMemberRole(T, 'u-home', role, { actorRole }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('rejects PLATFORM_ADMIN and users outside the tenant', async () => {
      asMember(homeUser, null);
      await expect(
        service.updateMemberRole(T, 'u-home', 'PLATFORM_ADMIN', {
          actorRole: 'OWNER',
        }),
      ).rejects.toThrow(BadRequestException);

      asMember(invitedUser, null);
      await expect(
        service.updateMemberRole(T, 'u-invited', 'MEMBER', {
          actorRole: 'OWNER',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('deletes the account of a user who belongs only to this tenant', async () => {
      asMember(homeUser, null);

      const result = await service.removeMember(T, 'u-home', {
        actorId: 'owner-1',
      });

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'u-home' },
      });
      // Nada de devolver o registro do usuário (hash da senha, segredo MFA).
      expect(result).toEqual({
        id: 'u-home',
        email: 'home@acme.com',
        removed: true,
        accountDeleted: true,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.member.removed',
          changes: {
            tenantId: T,
            email: 'home@acme.com',
            role: 'MEMBER',
            accountDeleted: true,
          },
        }),
      );
    });

    it('only revokes access to this tenant for an invited member', async () => {
      asMember(invitedUser, { id: 'm-1', status: 'active', role: 'DEVELOPER' });
      prisma.tenantMembership.findMany.mockResolvedValue([
        { tenantId: 'tenant-other', role: 'OWNER' },
      ]);

      const result = await service.removeMember(T, 'u-invited');

      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.tenantMembership.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: T, userId: 'u-invited' },
      });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-invited', tenantId: T, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ removed: true, accountDeleted: false });
    });

    it('moves the home tenant of a user who still belongs to another tenant', async () => {
      asMember(homeUser, null);
      prisma.tenantMembership.findMany.mockResolvedValue([
        { tenantId: 'tenant-b', role: 'DEVELOPER' },
      ]);

      await service.removeMember(T, 'u-home');

      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-home' },
        data: { tenantId: 'tenant-b', role: 'DEVELOPER' },
      });
    });

    it('keeps the last OWNER, counting owners from both paths', async () => {
      asMember(invitedUser, { id: 'm-1', status: 'active', role: 'OWNER' });
      prisma.user.count.mockResolvedValue(1);

      await expect(service.removeMember(T, 'u-invited')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.count.mock.calls[0][0].where.OR).toHaveLength(2);
      expect(prisma.tenantMembership.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 404 for someone who is not a member', async () => {
      asMember(null, null);
      await expect(service.removeMember(T, 'nobody')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
