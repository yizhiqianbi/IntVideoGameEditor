import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { getLocalCachedUserByEmail } from "./local-auth-cache";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = normalizeEmail(credentials.email);

        try {
          const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
          });

          if (user) {
            const valid = await bcrypt.compare(credentials.password, user.password);
            if (!valid) return null;

            return { id: user.id, email: user.email, name: user.name };
          }
        } catch {
          // Fall back to the local auth cache for local development.
        }

        const localUser = await getLocalCachedUserByEmail(normalizedEmail);

        if (!localUser) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, localUser.password);
        if (!valid) return null;

        return {
          id: localUser.id,
          email: localUser.email,
          name: localUser.name,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET ?? "pencil-studio-dev-secret-change-me",
};
