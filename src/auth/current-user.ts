import "server-only";
import { headers } from "next/headers";
import type { UserModel } from "../generated/prisma/models/User";
import { getPrisma } from "./db";
import { provisionDomainUser } from "./provision";
import { auth } from "./server";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/** The only source of ownerId for protected domain code. */
export async function requireCurrentUser(): Promise<UserModel> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) throw new UnauthenticatedError();
  return provisionDomainUser(getPrisma(), session.user.id);
}

export async function getCurrentUser(): Promise<UserModel | null> {
  try {
    return await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null;
    throw error;
  }
}
