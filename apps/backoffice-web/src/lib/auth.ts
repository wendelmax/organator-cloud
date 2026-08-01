import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const API_URL = process.env.API_URL || "http://localhost:3001";

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
    async jwt({ token, user, account }) {
      if (user) {
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.mustChangePassword = (user as any).mustChangePassword;
        token.mfaEnabled = (user as any).mfaEnabled;
        token.accessToken = (user as any).token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).mustChangePassword = token.mustChangePassword;
        (session as any).accessToken = token.accessToken;
      }
      return session;
    }
  }
};
