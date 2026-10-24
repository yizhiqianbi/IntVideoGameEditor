import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LocalCachedUser = {
  id: string;
  email: string;
  password: string;
  name: string | null;
  credits: number;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_CREDITS = 200;
const LOCAL_AUTH_CACHE_PATH =
  process.env.LOCAL_AUTH_CACHE_FILE ??
  path.join(process.cwd(), ".data", "local-auth-users.json");

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function ensureCacheDirectory() {
  await mkdir(path.dirname(LOCAL_AUTH_CACHE_PATH), { recursive: true });
}

async function readLocalAuthUsers() {
  try {
    const rawValue = await readFile(LOCAL_AUTH_CACHE_PATH, "utf8");
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [] as LocalCachedUser[];
    }

    return parsed
      .filter((entry): entry is LocalCachedUser => {
        return (
          entry &&
          typeof entry.id === "string" &&
          typeof entry.email === "string" &&
          typeof entry.password === "string"
        );
      })
      .map((entry) => ({
        ...entry,
        email: normalizeEmail(entry.email),
        name: entry.name ?? null,
        credits:
          typeof entry.credits === "number" && Number.isFinite(entry.credits)
            ? entry.credits
            : DEFAULT_CREDITS,
        createdAt:
          typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof entry.updatedAt === "string"
            ? entry.updatedAt
            : new Date().toISOString(),
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [] as LocalCachedUser[];
    }

    throw error;
  }
}

async function writeLocalAuthUsers(users: LocalCachedUser[]) {
  await ensureCacheDirectory();
  await writeFile(
    LOCAL_AUTH_CACHE_PATH,
    JSON.stringify(users, null, 2),
    "utf8",
  );
}

export async function getLocalCachedUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const users = await readLocalAuthUsers();

  return users.find((user) => user.email === normalizedEmail) ?? null;
}

export async function getLocalCachedUserById(id: string) {
  const users = await readLocalAuthUsers();

  return users.find((user) => user.id === id) ?? null;
}

export async function createLocalCachedUser(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
}) {
  const users = await readLocalAuthUsers();
  const normalizedEmail = normalizeEmail(input.email);

  if (users.some((user) => user.email === normalizedEmail)) {
    throw new Error("Email already registered");
  }

  const now = new Date().toISOString();
  const nextUser: LocalCachedUser = {
    id: `local_${randomUUID()}`,
    email: normalizedEmail,
    password: input.passwordHash,
    name: input.name?.trim() ? input.name.trim() : null,
    credits: DEFAULT_CREDITS,
    createdAt: now,
    updatedAt: now,
  };

  users.push(nextUser);
  await writeLocalAuthUsers(users);

  return nextUser;
}

export async function upsertLocalCachedUser(user: LocalCachedUser) {
  const users = await readLocalAuthUsers();
  const nextUsers = users.filter((entry) => entry.id !== user.id);

  nextUsers.push({
    ...user,
    email: normalizeEmail(user.email),
    name: user.name ?? null,
    updatedAt: user.updatedAt || new Date().toISOString(),
  });

  await writeLocalAuthUsers(nextUsers);

  return user;
}

export async function updateLocalCachedUserCredits(id: string, credits: number) {
  const users = await readLocalAuthUsers();
  const nextUsers = users.map((user) =>
    user.id === id
      ? {
          ...user,
          credits,
          updatedAt: new Date().toISOString(),
        }
      : user,
  );

  await writeLocalAuthUsers(nextUsers);
}

export function isLocalCachedUserId(id: string) {
  return id.startsWith("local_");
}
