import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text", placeholder: "admin@navant.app" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        // Implementação nativa da validação com a Control Plane API
        // Substituir Keycloak: Faremos a chamada para a nossa API em NestJS
        if (credentials?.email === "admin@navant.app" && credentials?.password === "admin") {
          return { id: "1", name: "Admin Navant", email: "admin@navant.app", role: "ADMIN" };
        }
        return null;
      }
    })
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        (session.user as any).role = token.role;
      }
      return session;
    }
  }
});

export { handler as GET, handler as POST };
