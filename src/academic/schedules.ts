import { Temporal } from "@js-temporal/polyfill";
import type { PrismaClient } from "../generated/prisma/client";
import type { ClassScheduleModel } from "../generated/prisma/models/ClassSchedule";
import { AcademicError, invalid, notFound } from "./errors";
import { mutation, ownedCourse, ownedTerm, type AcademicOwner, type AcademicTx } from "./records";
import { academicDate, localInstant, originalOccurrence, type Series } from "./recurrence";
import { dateInput, idInput, literalDate, literalTime, optionalText, scheduleInput, timeInput, zoneInput } from "./validation";

export function seriesFromRow(row: ClassScheduleModel): Series {
  return { ...row, localStartTime: literalTime(row.localStartTime), localEndTime: literalTime(row.localEndTime),
    originalStartDate: literalDate(row.originalStartDate), originalEndDate: literalDate(row.originalEndDate), retiredFromDate: row.retiredFromDate ? literalDate(row.retiredFromDate) : null };
}
export async function ownedSchedule(db: PrismaClient | AcademicTx, owner: AcademicOwner, id: unknown) {
  const row = await db.classSchedule.findFirst({ where: { id: idInput(id), ownerId: idInput(owner.id) } });
  return row ?? notFound();
}
export async function listSchedules(prisma: PrismaClient, owner: AcademicOwner, courseId: unknown) {
  const course = await ownedCourse(prisma, owner, courseId);
  return prisma.classSchedule.findMany({ where: { ownerId: owner.id, courseId: course.id }, orderBy: [{ originalStartDate: "asc" }, { id: "asc" }] });
}
async function eligibleCourse(tx: AcademicTx, owner: AcademicOwner, id: unknown) {
  const course = await ownedCourse(tx, owner, id);
  const term = await ownedTerm(tx, owner, course.termId);
  if (course.archivedAt || term.archivedAt || (course.status !== "ACTIVE" && course.status !== "UPCOMING")) throw new AcademicError("INVALID_STATE", "Schedules require a non-archived UPCOMING or ACTIVE course and non-archived term.");
  return course;
}
async function insertSeries(tx: AcademicTx, owner: AcademicOwner, courseId: string, data: ReturnType<typeof scheduleInput>, predecessor: string | null = null) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO public.class_schedule (owner_id, course_id, weekday, local_start_time, local_end_time, end_day_offset, timezone,
      original_start_date, original_end_date, location, predecessor_id)
    VALUES (${owner.id}::uuid, ${courseId}::uuid, ${data.weekday}::smallint, ${data.localStartTime}::time, ${data.localEndTime}::time,
      ${data.endDayOffset}::smallint, ${data.timezone}, ${data.originalStartDate}::date, ${data.originalEndDate}::date, ${data.location}, ${predecessor}::uuid) RETURNING id
  `;
  return tx.classSchedule.findUniqueOrThrow({ where: { id: rows[0]!.id } });
}
export async function createSchedule(prisma: PrismaClient, owner: AcademicOwner, input: Record<string, unknown>) {
  const data = scheduleInput(input);
  const courseId = idInput(input.courseId);
  return mutation(prisma, owner, async (tx) => {
    await eligibleCourse(tx, owner, courseId);
    return insertSeries(tx, owner, courseId, data);
  });
}
function requireOccurrence(row: ClassScheduleModel, date: string) {
  if (!originalOccurrence(seriesFromRow(row), date)) invalid("Choose a real occurrence within the active recurrence range.");
}
export async function putException(prisma: PrismaClient, owner: AcademicOwner, scheduleId: unknown, input: Record<string, unknown>) {
  const date = dateInput(input.originalDate, "Original occurrence date");
  if (input.kind !== "CANCEL" && input.kind !== "MOVE") invalid("Choose CANCEL or MOVE.");
  const kind: "CANCEL" | "MOVE" = input.kind;
  let replacementStartsAt: Date | null = null;
  let replacementEndsAt: Date | null = null;
  let replacementTimezone: string | null = null;
  let replacementLocation: string | null = null;
  if (kind === "MOVE") {
    replacementTimezone = zoneInput(input.replacementTimezone);
    replacementStartsAt = localInstant(dateInput(input.replacementStartDate), timeInput(input.replacementStartTime), replacementTimezone);
    replacementEndsAt = localInstant(dateInput(input.replacementEndDate), timeInput(input.replacementEndTime), replacementTimezone);
    if (!replacementStartsAt || !replacementEndsAt || replacementEndsAt <= replacementStartsAt) invalid("Move requires real local start/end times and a positive interval.");
    replacementLocation = optionalText(input.replacementLocation, "Replacement location", 500);
  } else if (["replacementStartDate", "replacementStartTime", "replacementEndDate", "replacementEndTime", "replacementTimezone", "replacementLocation"].some((key) => input[key] != null && input[key] !== "")) invalid("CANCEL cannot contain a replacement payload.");
  return mutation(prisma, owner, async (tx) => {
    const row = await ownedSchedule(tx, owner, scheduleId);
    requireOccurrence(row, date);
    const data = { kind, replacementStartsAt, replacementEndsAt, replacementTimezone, replacementLocation };
    // One identity, with an explicit replace operation; competing writes serialize.
    const found = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.class_schedule_exception
      WHERE owner_id=${owner.id}::uuid AND schedule_id=${row.id}::uuid AND original_date=${date}::date`;
    if (found[0]) return tx.classScheduleException.update({ where: { id: found[0].id }, data });
    const inserted = await tx.$queryRaw<{ id: string }[]>`INSERT INTO public.class_schedule_exception
      (owner_id,schedule_id,original_date,kind,replacement_starts_at,replacement_ends_at,replacement_timezone,replacement_location)
      VALUES (${owner.id}::uuid,${row.id}::uuid,${date}::date,${kind}::"ScheduleExceptionKind",${replacementStartsAt}::timestamptz,
        ${replacementEndsAt}::timestamptz,${replacementTimezone},${replacementLocation}) RETURNING id`;
    return tx.classScheduleException.findUniqueOrThrow({ where: { id: inserted[0]!.id } });
  });
}
export async function removeException(prisma: PrismaClient, owner: AcademicOwner, scheduleId: unknown, originalDate: unknown) {
  const date = dateInput(originalDate);
  return mutation(prisma, owner, async (tx) => {
    const row = await ownedSchedule(tx, owner, scheduleId);
    requireOccurrence(row, date);
    return tx.$executeRaw`DELETE FROM public.class_schedule_exception WHERE owner_id=${owner.id}::uuid AND schedule_id=${row.id}::uuid AND original_date=${date}::date`;
  });
}
export async function splitSchedule(prisma: PrismaClient, owner: AcademicOwner, scheduleId: unknown, boundary: unknown, input: Record<string, unknown>, now = new Date()) {
  const date = dateInput(boundary, "Split occurrence date");
  const data = scheduleInput({ ...input, originalStartDate: date });
  const courseId = idInput(input.courseId);
  return mutation(prisma, owner, async (tx) => {
    const row = await ownedSchedule(tx, owner, scheduleId);
    requireOccurrence(row, date); // Before CANCEL/MOVE, using original identity.
    if (date < academicDate(now, row.timezone)) throw new AcademicError("INVALID_STATE", "This and future cannot rewrite dates before today in the source timezone.");
    if (await tx.classSchedule.findFirst({ where: { predecessorId: row.id, ownerId: owner.id } })) throw new AcademicError("CONFLICT", "Only the current tail of a series can be split.");
    if (courseId !== row.courseId) throw new AcademicError("INVALID_INPUT", "A successor must retain the source course.");
    await eligibleCourse(tx, owner, courseId);
    // A newly generated UUID pointing only to the locked tail cannot create a cycle.
    await tx.$executeRaw`UPDATE public.class_schedule SET retired_from_date=${date}::date WHERE id=${row.id}::uuid AND owner_id=${owner.id}::uuid`;
    await tx.$executeRaw`DELETE FROM public.class_schedule_exception WHERE schedule_id=${row.id}::uuid AND owner_id=${owner.id}::uuid AND original_date>=${date}::date`;
    return insertSeries(tx, owner, courseId, data, row.id);
  });
}
export async function retireSchedule(prisma: PrismaClient, owner: AcademicOwner, scheduleId: unknown, boundary: unknown, now = new Date()) {
  const date = dateInput(boundary, "First excluded occurrence");
  return mutation(prisma, owner, async (tx) => {
    const row = await ownedSchedule(tx, owner, scheduleId);
    requireOccurrence(row, date);
    if (date < academicDate(now, row.timezone)) throw new AcademicError("INVALID_STATE", "Retirement cannot rewrite past dates.");
    if (await tx.classSchedule.findFirst({ where: { ownerId: owner.id, predecessorId: row.id } })) throw new AcademicError("INVALID_STATE", "Only the current tail can be retired.");
    await tx.$executeRaw`DELETE FROM public.class_schedule_exception WHERE owner_id=${owner.id}::uuid AND schedule_id=${row.id}::uuid AND original_date>=${date}::date`;
    await tx.$executeRaw`UPDATE public.class_schedule SET retired_from_date=${date}::date WHERE owner_id=${owner.id}::uuid AND id=${row.id}::uuid`;
    return tx.classSchedule.findUniqueOrThrow({ where: { id: row.id } });
  });
}
export function weekStart(date: string) {
  const day = Temporal.PlainDate.from(date);
  return day.subtract({ days: day.dayOfWeek - 1 }).toString();
}
