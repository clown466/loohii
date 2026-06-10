import { createRequire } from "node:module";

const globalForPrisma = globalThis as unknown as {
  prisma?: any;
};

const require = createRequire(import.meta.url);
const PrismaClient = loadPrismaClient();

export const prisma =
  globalForPrisma.prisma ??
  (PrismaClient
    ? new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      })
    : createMissingPrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function loadPrismaClient(): (new (...args: any[]) => any) | null {
  try {
    return require("@prisma/client").PrismaClient ?? null;
  } catch {
    return null;
  }
}

function createMissingPrismaClient() {
  const fail = () => {
    throw new Error("Prisma Client is not generated. Configure Prisma 7 datasource settings, then run prisma generate.");
  };

  return new Proxy(
    {
      $disconnect: async () => undefined,
      $queryRaw: fail,
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return new Proxy({}, { get: () => fail });
      },
    },
  );
}
