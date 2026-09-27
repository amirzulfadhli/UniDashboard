import type { PrismaClient } from "../generated/prisma/client";
import { withOwnerTransaction } from "../db/owner-transaction";
import { parseProfileInput, parseProgrammeInput, parseTermInput, OnboardingValidationError } from "./validation";

/** The caller must obtain this value from requireCurrentUser(), never a request body. */
export type CurrentDomainUser = { id: string };

export async function getOnboardingState(prisma: PrismaClient, currentUser: CurrentDomainUser) {
  const [profile, programme, firstTerm] = await Promise.all([
    prisma.profile.findUnique({ where: { ownerId: currentUser.id } }),
    prisma.programme.findUnique({ where: { ownerId: currentUser.id } }),
    prisma.term.findFirst({ where: { ownerId: currentUser.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const selectedTerm = profile?.selectedTermId
    ? await prisma.term.findFirst({ where: { id: profile.selectedTermId, ownerId: currentUser.id } })
    : null;
  return {
    profile,
    programme,
    firstTerm,
    selectedTerm,
    complete: profile !== null && firstTerm !== null && selectedTerm !== null,
  };
}

export async function saveProfile(
  prisma: PrismaClient,
  currentUser: CurrentDomainUser,
  input: Record<string, unknown>,
) {
  const data = parseProfileInput(input);
  return withOwnerTransaction(prisma, currentUser.id, (tx) => tx.profile.upsert({
    where: { ownerId: currentUser.id },
    create: { ownerId: currentUser.id, ...data },
    update: data,
  }));
}

export async function saveProgramme(
  prisma: PrismaClient,
  currentUser: CurrentDomainUser,
  input: Record<string, unknown>,
) {
  const data = parseProgrammeInput(input);
  return withOwnerTransaction(prisma, currentUser.id, async (tx) => {
    const profile = await tx.profile.findUnique({ where: { ownerId: currentUser.id }, select: { ownerId: true } });
    if (!profile) throw new OnboardingValidationError("Complete your profile before adding a programme.");
    return tx.programme.upsert({
      where: { ownerId: currentUser.id },
      create: { ownerId: currentUser.id, ...data },
      update: data,
    });
  });
}

export async function completeFirstTerm(
  prisma: PrismaClient,
  currentUser: CurrentDomainUser,
  input: Record<string, unknown>,
) {
  const data = parseTermInput(input);
  return withOwnerTransaction(prisma, currentUser.id, async (tx) => {
    const profile = await tx.profile.findUnique({ where: { ownerId: currentUser.id } });
    if (!profile) throw new OnboardingValidationError("Complete your profile before creating a term.");

    // The account row lock serializes double submits and concurrent requests.
    // Once a first term exists, every replay converges on that same term.
    let firstTerm = await tx.term.findFirst({
      where: { ownerId: currentUser.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!firstTerm) {
      // PostgreSQL receives literal DATE strings; no JavaScript instant or local
      // timezone conversion participates in date-only persistence.
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO public.term (owner_id, name, starts_on, ends_on, teaching_starts_on, academic_timezone)
        VALUES (
          ${currentUser.id}::uuid, ${data.name}, ${data.startsOn}::date,
          ${data.endsOn}::date, ${data.teachingStartsOn}::date, ${data.academicTimezone}
        )
        RETURNING id
      `;
      if (inserted.length !== 1 || !inserted[0]) throw new Error("First term was not created.");
      firstTerm = inserted[0];
    }
    if (!profile.selectedTermId) {
      await tx.profile.update({ where: { ownerId: currentUser.id }, data: { selectedTermId: firstTerm.id } });
    }
    return firstTerm.id;
  });
}
