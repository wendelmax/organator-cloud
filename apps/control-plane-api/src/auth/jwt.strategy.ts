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
      include: { tenant: { select: { status: true } } },
    });
    if (!user) return null;
    if (user.tenant && user.tenant.status !== 'active') return null;

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
