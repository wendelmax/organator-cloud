import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const API_URL = process.env.API_URL || "http://localhost:3001";

/**
 * Confirma na API que o access token é válido (assinatura, sessão ativa) e
 * devolve role/tenant das claims assinadas. Retorna null se a API recusar.
 */
export async function verifiedTokenContext(
  accessToken: string,
): Promise<{
  role?: string;
  tenantId?: string;
  /** Sessão de suporte: e-mail de quem está acessando como o usuário. */
  impersonatedBy?: string | null;
  email?: string;
} | null> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    const me = typeof res.json === "function" ? await res.json().catch(() => null) : null;
    return {
      role: payload.role,
      tenantId: payload.tenantId,
      ...(me?.impersonatedBy ? { impersonatedBy: me.impersonatedBy, email: me.email } : {}),
    };
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text", placeholder: "admin@organator.app" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        try {
          const res = await fetch(`${API_URL}/v1/auth/login`, {
            method: 'POST',
            body: JSON.stringify({
              email: credentials?.email,
              password: credentials?.password
            }),
            headers: { "Content-Type": "application/json" }
          });
          const data = await res.json();
          if (res.ok && data.access_token) {
            return {
              id: data.user.id,
              name: data.user.email,
              email: data.user.email,
              role: data.user.role,
              tenantId: data.user.tenantId,
              mustChangePassword: data.user.mustChangePassword,
              mfaEnabled: data.user.mfaEnabled,
              token: data.access_token
            };
          }
          return null;
        } catch (e) {
          return null;
        }
      }
    }),
    // SSO via VoidAuth (OIDC) — o backoffice confia apenas nos tokens
    // OIDC que a control-plane-api valida por JWKS (OidcStrategy).
    // Provider OAuth genérico: endpoints descobertos via wellKnown do VoidAuth.
    ...(process.env.VOIDAUTH_CLIENT_ID && process.env.VOIDAUTH_CLIENT_SECRET
      ? [
          {
            id: "voidauth",
            name: "VoidAuth",
            type: "oauth" as const,
            clientId: process.env.VOIDAUTH_CLIENT_ID,
            clientSecret: process.env.VOIDAUTH_CLIENT_SECRET,
            wellKnown: `${process.env.VOIDAUTH_URL || "http://localhost:3003"}/oidc/.well-known/openid-configuration`,
            idToken: true,
            checks: ["pkce", "state"] as any,
            authorization: {
              params: { scope: "openid profile email groups" },
            },
            profile(profile: Record<string, any>) {
              return {
                id: profile.sub,
                name: profile.name || profile.preferred_username,
                email: profile.email,
                image: profile.picture,
                token: "",
              };
            },
          },
        ]
      : [])
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user, session, trigger }) {
      if (user) {
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.mustChangePassword = (user as any).mustChangePassword;
        token.mfaEnabled = (user as any).mfaEnabled;
        token.accessToken = (user as any).token;
      }
      // Troca de tenant: o cliente envia o novo access token via update().
      // Role/tenant nunca vêm do cliente — saem das claims do token, depois
      // que a API confirma que ele é válido.
      if (trigger === "update" && typeof (session as any)?.accessToken === "string") {
        const context = await verifiedTokenContext((session as any).accessToken);
        if (context) {
          token.accessToken = (session as any).accessToken;
          token.tenantId = context.tenantId;
          token.role = context.role;
          // Sessão de suporte (#103): o banner mostra quem acessa como quem.
          if (context.impersonatedBy) {
            token.impersonatedBy = context.impersonatedBy;
            token.actingAs = context.email;
          } else {
            delete token.impersonatedBy;
            delete token.actingAs;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).mustChangePassword = token.mustChangePassword;
        (session as any).accessToken = token.accessToken;
        if (token.impersonatedBy) {
          (session.user as any).impersonatedBy = token.impersonatedBy;
          (session.user as any).actingAs = token.actingAs;
        }
      }
      return session;
    }
  }
};
