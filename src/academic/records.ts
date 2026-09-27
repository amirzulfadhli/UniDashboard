import type { PrismaClient } from "../generated/prisma/client";
import { withOwnerTransaction } from "../db/owner-transaction";
import { AcademicError, invalid, notFound } from "./errors";
import { idInput, optionalText, termInput, textInput } from "./validation";

export type AcademicOwner = Readonly<{ id: string }>;
export type AcademicTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function mutation<T>(prisma: PrismaClient, owner: AcademicOwner, write: (tx: AcademicTx) => Promise<T>): Promise<T> {
  idInput(owner.id);
  try { return await withOwnerTransaction(prisma, owner.id, write); } catch (error) {
    if (error instanceof AcademicError) throw error;
    const code = (error as { code?: string }).code;
    if (code === "P2002") throw new AcademicError("CONFLICT", "This academic record already exists.");
    if (code === "P2003" || code === "P2004" || code === "P2010") throw new AcademicError("INVALID_STATE", "The proposed change violates an academic relationship or retained history.");
    throw error;
  }
}
export async function ownedTerm(db: PrismaClient | AcademicTx, owner: AcademicOwner, id: unknown) {
  const record = await db.term.findFirst({ where: { id: idInput(id), ownerId: idInput(owner.id) } });
  return record ?? notFound();
}
export async function ownedCourse(db: PrismaClient | AcademicTx, owner: AcademicOwner, id: unknown) {
  const record = await db.course.findFirst({ where: { id: idInput(id), ownerId: idInput(owner.id) } });
  return record ?? notFound();
}
export function listTerms(prisma: PrismaClient, owner: AcademicOwner, includeArchived = false) {
  return prisma.term.findMany({ where: { ownerId: idInput(owner.id), ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ startsOn: "desc" }, { id: "asc" }] });
}
export async function createTerm(prisma: PrismaClient, owner: AcademicOwner, input: Record<string, unknown>) {
  const data = termInput(input);
  return mutation(prisma, owner, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO public.term (owner_id, name, starts_on, ends_on, teaching_starts_on, academic_timezone)
      VALUES (${owner.id}::uuid, ${data.name}, ${data.startsOn}::date, ${data.endsOn}::date, ${data.teachingStartsOn}::date, ${data.academicTimezone}) RETURNING id
    `;
    return tx.term.findUniqueOrThrow({ where: { id: rows[0]!.id } });
  });
}
export async function updateTerm(prisma: PrismaClient, owner: AcademicOwner, id: unknown, input: Record<string, unknown>) {
  const data = termInput(input);
  return mutation(prisma, owner, async (tx) => {
    const term = await ownedTerm(tx, owner, id);
    await tx.$executeRaw`UPDATE public.term SET name=${data.name}, starts_on=${data.startsOn}::date, ends_on=${data.endsOn}::date,
      teaching_starts_on=${data.teachingStartsOn}::date, academic_timezone=${data.academicTimezone} WHERE id=${term.id}::uuid AND owner_id=${owner.id}::uuid`;
    return tx.term.findUniqueOrThrow({ where: { id: term.id } });
  });
}
export async function selectTerm(prisma: PrismaClient, owner: AcademicOwner, id: unknown) {
  return mutation(prisma, owner, async (tx) => {
    const term = await ownedTerm(tx, owner, id);
    if (term.archivedAt) throw new AcademicError("INVALID_STATE", "Restore the term before selecting it.");
    const profile = await tx.profile.findUnique({ where: { ownerId: owner.id } });
    if (!profile) throw new AcademicError("INVALID_STATE", "Complete your profile first.");
    return tx.profile.update({ where: { ownerId: owner.id }, data: { selectedTermId: term.id } });
  });
}
export async function archiveTerm(prisma: PrismaClient, owner: AcademicOwner, id: unknown, archived: boolean) {
  return mutation(prisma, owner, async (tx) => {
    const term = await ownedTerm(tx, owner, id);
    if (archived) await tx.profile.updateMany({ where: { ownerId: owner.id, selectedTermId: term.id }, data: { selectedTermId: null } });
    return tx.term.update({ where: { id: term.id }, data: { archivedAt: archived ? term.archivedAt ?? new Date() : null } });
  });
}
export async function termLifecycle(prisma: PrismaClient, owner: AcademicOwner, id: unknown, status: unknown) {
  if (status !== "PLANNED" && status !== "ACTIVE" && status !== "CLOSED") invalid("Choose a valid term lifecycle state.");
  return mutation(prisma, owner, async (tx) => {
    const term = await ownedTerm(tx, owner, id);
    if (term.status === status) return term;
    const now = evidenceTime(term);
    return tx.term.update({ where: { id: term.id }, data: {
      status, statusChangedAt: now,
      ...(status === "CLOSED" ? { lastClosedAt: now } : {}),
      ...(status === "ACTIVE" ? (term.status === "CLOSED" ? { lastReopenedAt: now } : { lastActivatedAt: now }) : {}),
    } });
  });
}
function evidenceTime(record: object): Date {
  // Keep timestamps monotonic even if a clock adjustment precedes retained evidence.
  return new Date(Math.max(Date.now(), ...Object.entries(record).filter(([key, value]) => key.startsWith("last") && value instanceof Date).map(([, value]) => (value as Date).getTime())));
}
export async function listCourses(prisma: PrismaClient, owner: AcademicOwner, termId: unknown, includeArchived = false) {
  const term = await ownedTerm(prisma, owner, termId);
  return prisma.course.findMany({ where: { ownerId: owner.id, termId: term.id, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: [{ courseCode: "asc" }, { id: "asc" }] });
}
function courseInput(input: Record<string, unknown>) {
  return { termId: idInput(input.termId), courseCode: textInput(input.courseCode, "Course code", 100), title: textInput(input.title, "Course title"), description: optionalText(input.description, "Description") };
}
export async function createCourse(prisma: PrismaClient, owner: AcademicOwner, input: Record<string, unknown>) {
  const data = courseInput(input);
  return mutation(prisma, owner, async (tx) => {
    const term = await ownedTerm(tx, owner, data.termId);
    if (term.archivedAt) throw new AcademicError("INVALID_STATE", "Restore the term before adding a course.");
    return tx.course.create({ data: { ...data, ownerId: owner.id } });
  });
}
export async function updateCourse(prisma: PrismaClient, owner: AcademicOwner, id: unknown, input: Record<string, unknown>) {
  const data = courseInput(input);
  return mutation(prisma, owner, async (tx) => {
    const course = await ownedCourse(tx, owner, id);
    if (course.termId !== data.termId && course.firstDependantAt) throw new AcademicError("INVALID_STATE", "This course's term is locked because it has acquired a dependant.");
    const term = await ownedTerm(tx, owner, data.termId);
    if (course.termId !== term.id && term.archivedAt) throw new AcademicError("INVALID_STATE", "Restore the destination term first.");
    return tx.course.update({ where: { id: course.id }, data });
  });
}
export async function archiveCourse(prisma: PrismaClient, owner: AcademicOwner, id: unknown, archived: boolean) {
  return mutation(prisma, owner, async (tx) => {
    const course = await ownedCourse(tx, owner, id);
    return tx.course.update({ where: { id: course.id }, data: { archivedAt: archived ? course.archivedAt ?? new Date() : null } });
  });
}
export async function courseLifecycle(prisma: PrismaClient, owner: AcademicOwner, id: unknown, status: unknown) {
  if (status !== "UPCOMING" && status !== "ACTIVE" && status !== "COMPLETED" && status !== "CANCELLED") invalid("Choose a valid course lifecycle state.");
  return mutation(prisma, owner, async (tx) => {
    const course = await ownedCourse(tx, owner, id);
    if (course.status === status) return course;
    const now = evidenceTime(course);
    return tx.course.update({ where: { id: course.id }, data: {
      status, statusChangedAt: now,
      ...(status === "COMPLETED" ? { lastCompletedAt: now } : {}),
      ...(status === "CANCELLED" ? { lastCancelledAt: now } : {}),
      ...(status === "ACTIVE" ? (course.status === "COMPLETED" ? { lastReopenedAt: now } : course.status === "CANCELLED" ? { lastReinstatedAt: now } : { lastActivatedAt: now }) : {}),
    } });
  });
}
