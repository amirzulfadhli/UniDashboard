import { createPrismaClient } from "../db/client";

// One client and one UTC-configured adapter pool per server process. Every auth
// and domain query must use this path.
const globalPrisma = globalThis as typeof globalThis & {
  __uniosPrisma?: ReturnType<typeof createPrismaClient>;
};

export function getPrisma(): ReturnType<typeof createPrismaClient> {
  return (globalPrisma.__uniosPrisma ??= createPrismaClient());
}
