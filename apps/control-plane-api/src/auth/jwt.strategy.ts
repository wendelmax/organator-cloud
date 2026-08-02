import { Injectable } from '@nestjs/common';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { jwtConstants } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConstants.secret,
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: { select: { status: true, state: true } } },
    });
    if (!user) return null;
    // Tenants em offboarding/deleted não podem usar a API (#46).
    // past_due/suspended passam para o TenantStateGuard decidir
    // (read-only vs paywall).
    const state = user.tenant?.state || 'active';
    if (user.tenant && ['offboarding', 'deleted'].includes(state)) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
      authProvider: user.authProvider,
    };
  }
}
