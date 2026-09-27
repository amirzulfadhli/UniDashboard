import type { PrismaClient } from "../generated/prisma/client";
import type { UserModel } from "../generated/prisma/models/User";

export class AuthIdentityMissingError extends Error {
  constructor() {
    super("Authenticated identity no longer exists");
    this.name = "AuthIdentityMissingError";
  }
}

/** Resolve one AuthUser to exactly one domain User. Caller supplies only the
 * server-validated auth identity, never a domain owner ID from a request. */
export async function provisionDomainUser(
  prisma: PrismaClient,
  authenticatedAuthUserId: string,
): Promise<UserModel> {
  if (!authenticatedAuthUserId) throw new AuthIdentityMissingError();

  return prisma.$transaction(async (tx) => {
    // The account row serializes all provisioners, including separate app
    // processes. This follows Task 1's owner-row locking protocol.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "AuthUser"
      WHERE id = ${authenticatedAuthUserId}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new AuthIdentityMissingError();

    const identity = await tx.authUser.findUniqueOrThrow({
      where: { id: authenticatedAuthUserId },
      select: { domainUserId: true },
    });
    if (identity.domainUserId) {
      return tx.user.findUniqueOrThrow({ where: { id: identity.domainUserId } });
    }

    const domainUser = await tx.user.create({ data: {} });
    await tx.authUser.update({
      where: { id: authenticatedAuthUserId },
      data: { domainUserId: domainUser.id },
    });
    return domainUser;
  });
}
