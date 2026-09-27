import "server-only";
import { redirect } from "next/navigation";
import { requireCurrentUser, UnauthenticatedError } from "../auth/current-user";

export async function requirePageUser() {
  try {
    return await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    throw error;
  }
}
