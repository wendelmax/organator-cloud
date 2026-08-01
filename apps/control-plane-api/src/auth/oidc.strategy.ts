import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as jose from 'jose';
import { PrismaService } from '../prisma/prisma.service';

export const AUTH_MODES = ['legacy', 'oidc', 'both'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export function resolveAuthMode(): AuthMode {
  const mode = (process.env.AUTH_MODE || 'both').toLowerCase();
  return AUTH_MODES.includes(mode as AuthMode) ? (mode as AuthMode) : 'both';
}

type RemoteJWKSet = ReturnType<typeof jose.createRemoteJWKSet>;

/**
 * Valida tokens emitidos por um OIDC Provider (ex.: VoidAuth) via JWKS.
 * passport-jwt verifica a assinatura via jsonwebtoken, então a chave JWKS
 * é exportada como PEM (SPKI) no secretOrKeyProvider por kid do header.
 * A identidade é unificada por e-mail/sub: tenantId e role são SEMPRE
 * lidos do banco a cada requisição (nunca dos claims do token).
 */
@Injectable()
export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
  private readonly logger = new Logger(OidcStrategy.name);
  private jwks: RemoteJWKSet | null = null;

  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256', 'ES256'],
      secretOrKeyProvider: (request, rawJwtToken, done) => {
        this.resolveSigningKey(rawJwtToken).then(
          (pem) => done(null, pem),
          (err) => done(err as Error, undefined),
        );
      },
    });
  }

  private async getJwks(): Promise<RemoteJWKSet> {
    if (this.jwks) return this.jwks;

    const baseUrl = process.env.VOIDAUTH_URL;
    if (!baseUrl) {
      throw new Error('VOIDAUTH_URL not configured');
    }
    const discoveryUrl = `${baseUrl.replace(/\/$/, '')}/oidc/.well-known/openid-configuration`;
    const res = await fetch(discoveryUrl);
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
    }
    const doc = (await res.json()) as { jwks_uri?: string };
    if (!doc.jwks_uri) {
      throw new Error('OIDC discovery did not expose jwks_uri');
    }
    this.jwks = jose.createRemoteJWKSet(new URL(doc.jwks_uri));
    return this.jwks;
  }

  private async resolveSigningKey(rawJwtToken: string): Promise<string> {
    const protectedHeader = jose.decodeProtectedHeader(rawJwtToken);
    const key = await (await this.getJwks())(protectedHeader);
    if (key instanceof Uint8Array) {
      throw new UnauthorizedException(
        'OIDC tokens com chave simétrica não são suportados',
      );
    }
    return jose.exportSPKI(key);
  }

  async validate(payload: any) {
    if (
      process.env.VOIDAUTH_ISSUER &&
      payload?.iss !== process.env.VOIDAUTH_ISSUER
    ) {
      throw new UnauthorizedException('OIDC token issued by unknown issuer');
    }
    if (
      process.env.VOIDAUTH_CLIENT_ID &&
      payload?.aud !== process.env.VOIDAUTH_CLIENT_ID
    ) {
      throw new UnauthorizedException('OIDC token audience mismatch');
    }
    if (!payload?.email && !payload?.sub) {
      throw new UnauthorizedException('OIDC token without email/sub');
    }
    const identifier = payload.email || payload.sub;
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { externalId: payload.sub }],
      },
    });
    if (!user) {
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
