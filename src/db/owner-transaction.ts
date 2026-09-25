import type { PrismaClient } from "../generated/prisma/client.js";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Serialize V1 mutations for one authenticated account before reading mutable state. */
export async function withOwnerTransaction<T>(
  prisma: PrismaClient,
  authenticatedOwnerId: string,
  mutate: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public.app_user
      WHERE id = ${authenticatedOwnerId}::uuid
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("Authenticated account does not exist");
    return mutate(tx);
  }, { isolationLevel: "ReadCommitted" });
}
