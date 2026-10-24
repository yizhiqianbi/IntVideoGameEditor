import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  createLocalCachedUser,
  getLocalCachedUserByEmail,
  upsertLocalCachedUser,
} from "@/lib/local-auth-cache";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const existingLocalUser = await getLocalCachedUserByEmail(normalizedEmail);

    let existingDatabaseUser = null;

    try {
      existingDatabaseUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
    } catch {
      existingDatabaseUser = null;
    }

    if (existingDatabaseUser || existingLocalUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    const hashed = await bcrypt.hash(password, 10);

    try {
      const user = await prisma.user.create({
        data: { email: normalizedEmail, password: hashed, name: name || null },
        select: {
          id: true,
          email: true,
          name: true,
          credits: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await upsertLocalCachedUser({
        id: user.id,
        email: user.email,
        password: hashed,
        name: user.name,
        credits: user.credits,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      });

      return NextResponse.json(
        {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            credits: user.credits,
          },
        },
        { status: 201 },
      );
    } catch {
      const localUser = await createLocalCachedUser({
        email: normalizedEmail,
        passwordHash: hashed,
        name: name || null,
      });

      return NextResponse.json(
        {
          user: {
            id: localUser.id,
            email: localUser.email,
            name: localUser.name,
            credits: localUser.credits,
          },
        },
        { status: 201 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
