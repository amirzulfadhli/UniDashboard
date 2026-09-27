import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createPrismaClient } from "../src/db/client.js";
import { completeFirstTerm, getOnboardingState, saveProfile, saveProgramme } from "../src/onboarding/service.js";
import { OnboardingValidationError, parseIanaTimezone, parseLiteralDate, parseTermInput } from "../src/onboarding/validation.js";

const prisma = createPrismaClient();
after(async () => prisma.$disconnect());

const termInput = {
  name: "Autumn 2026",
  academicTimezone: "Europe/London",
  startsOn: "2026-09-01",
  endsOn: "2026-12-31",
  teachingStartsOn: "2026-09-14",
};

test("service boundary rejects invalid timezones and literal dates", () => {
  assert.equal(parseIanaTimezone("America/New_York"), "America/New_York");
  assert.throws(() => parseIanaTimezone("+08:00"), OnboardingValidationError);
  assert.throws(() => parseIanaTimezone("Mars/Olympus"), OnboardingValidationError);
  assert.equal(parseLiteralDate("2024-02-29", "Start date"), "2024-02-29");
  assert.throws(() => parseLiteralDate("2025-02-29", "Start date"), OnboardingValidationError);
  assert.throws(() => parseLiteralDate("2026-01-01T00:00:00Z", "Start date"), OnboardingValidationError);
  assert.throws(() => parseTermInput({ ...termInput, startsOn: "2027-01-01" }), OnboardingValidationError);
  assert.throws(() => parseTermInput({ ...termInput, teachingStartsOn: "2027-01-01" }), OnboardingValidationError);
});

test("onboarding uses trusted owner, optional programme, literal dates, and completes once", async () => {
  const currentUser = await prisma.user.create({ data: {} });
  const other = await prisma.user.create({ data: {} });
  const before = await getOnboardingState(prisma, currentUser);
  assert.equal(before.complete, false);
  assert.equal(before.profile, null);
  await assert.rejects(saveProgramme(prisma, currentUser, { name: "Physics" }), OnboardingValidationError);

  await saveProfile(prisma, currentUser, {
    displayName: "  Student  ", timezone: "Europe/London", ownerId: other.id, authUserId: "forged",
  });
  const afterProfile = await getOnboardingState(prisma, currentUser);
  assert.equal(afterProfile.profile?.ownerId, currentUser.id);
  assert.equal(afterProfile.profile?.displayName, "Student");
  assert.equal(afterProfile.complete, false);
  assert.equal(await prisma.profile.findUnique({ where: { ownerId: other.id } }), null);

  // Programme can be skipped: first Term alone finishes setup.
  const termId = await completeFirstTerm(prisma, currentUser, { ...termInput, ownerId: other.id, domainUserId: other.id });
  const afterTerm = await getOnboardingState(prisma, currentUser);
  assert.equal(afterTerm.complete, true);
  assert.equal(afterTerm.programme, null);
  assert.equal(afterTerm.selectedTerm?.id, termId);
  assert.equal(afterTerm.selectedTerm?.ownerId, currentUser.id);
  const dates = await prisma.$queryRaw<{ starts_on: string; ends_on: string; teaching_starts_on: string }[]>`
    SELECT starts_on::text, ends_on::text, teaching_starts_on::text FROM public.term WHERE id = ${termId}::uuid
  `;
  assert.deepEqual(dates[0], { starts_on: termInput.startsOn, ends_on: termInput.endsOn, teaching_starts_on: termInput.teachingStartsOn });

  const repeatId = await completeFirstTerm(prisma, currentUser, { ...termInput, name: "Replay ignored" });
  assert.equal(repeatId, termId);
  assert.equal(await prisma.term.count({ where: { ownerId: currentUser.id } }), 1);

  await saveProgramme(prisma, currentUser, { name: "  Physics  ", description: "  BSc  ", ownerId: other.id });
  await saveProgramme(prisma, currentUser, { name: "Physics", description: "BSc" });
  assert.equal(await prisma.programme.count({ where: { ownerId: currentUser.id } }), 1);
  assert.equal(await prisma.programme.count({ where: { ownerId: other.id } }), 0);
});

test("concurrent first-term submissions serialize under the account row lock", async () => {
  const currentUser = await prisma.user.create({ data: {} });
  await saveProfile(prisma, currentUser, { timezone: "UTC" });
  const ids = await Promise.all(Array.from({ length: 6 }, () => completeFirstTerm(prisma, currentUser, termInput)));
  assert.equal(new Set(ids).size, 1);
  assert.equal(await prisma.term.count({ where: { ownerId: currentUser.id } }), 1);
  const state = await getOnboardingState(prisma, currentUser);
  assert.equal(state.selectedTerm?.id, ids[0]);
  assert.equal(state.complete, true);
});

test("database prevents cross-user selected-Term assignment", async () => {
  const first = await prisma.user.create({ data: {} });
  const second = await prisma.user.create({ data: {} });
  await saveProfile(prisma, first, { timezone: "UTC" });
  await saveProfile(prisma, second, { timezone: "UTC" });
  const secondTermId = await completeFirstTerm(prisma, second, termInput);
  await assert.rejects(prisma.profile.update({
    where: { ownerId: first.id }, data: { selectedTermId: secondTermId },
  }));
  assert.equal((await prisma.profile.findUnique({ where: { ownerId: first.id } }))?.selectedTermId, null);
});
