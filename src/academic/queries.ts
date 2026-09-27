import { Temporal } from "@js-temporal/polyfill";
import type { PrismaClient } from "../generated/prisma/client";
import { AcademicError, invalid } from "./errors";
import { ownedTerm, type AcademicOwner } from "./records";
import { academicDate, compareOccurrences, localDayRange, nextOccurrence, occurrencesInRange, type ClassOccurrence, type OccurrenceException } from "./recurrence";
import { seriesFromRow } from "./schedules";
import { dateInput, idInput, literalDate, zoneInput } from "./validation";

export type TimetableOccurrence = ClassOccurrence & { courseCode: string; courseTitle: string };
async function loadCandidates(prisma: PrismaClient, owner: AcademicOwner, termId: unknown, start: Date, end: Date, next = false) {
  idInput(owner.id);
  // Two calendar days cover all supported offsets and an overnight overlap.
  const lo = Temporal.PlainDate.from(academicDate(start, "UTC")).subtract({ days: 2 }).toString();
  const hi = next ? "9999-12-31" : Temporal.PlainDate.from(academicDate(end, "UTC")).add({ days: 2 }).toString();
  return prisma.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { ownerId: owner.id } });
    const selected = termId == null ? profile?.selectedTermId : idInput(termId);
    if (!selected) return [];
    const term = await ownedTerm(tx, owner, selected);
    if (term.archivedAt) return [];
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM public.class_schedule s JOIN public.course c ON c.id=s.course_id AND c.owner_id=s.owner_id
      WHERE s.owner_id=${owner.id}::uuid AND c.term_id=${term.id}::uuid AND c.archived_at IS NULL
        AND c.status IN ('UPCOMING','ACTIVE') AND (
          (s.original_start_date<=${hi}::date AND s.original_end_date>=${lo}::date
            AND (s.retired_from_date IS NULL OR s.retired_from_date>${lo}::date))
          OR EXISTS (SELECT 1 FROM public.class_schedule_exception e WHERE e.schedule_id=s.id AND e.owner_id=s.owner_id
            AND e.kind='MOVE' AND e.replacement_starts_at<${end}::timestamptz AND e.replacement_ends_at>${start}::timestamptz))
    `;
    if (!ids.length) return [];
    const schedules = await tx.classSchedule.findMany({ where: { id: { in: ids.map((row) => row.id) }, ownerId: owner.id }, include: { course: true } });
    const exceptionIds = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM public.class_schedule_exception e JOIN public.class_schedule s ON s.id=e.schedule_id AND s.owner_id=e.owner_id
      JOIN public.course c ON c.id=s.course_id AND c.owner_id=s.owner_id
      WHERE e.owner_id=${owner.id}::uuid AND c.term_id=${term.id}::uuid AND c.archived_at IS NULL AND c.status IN ('UPCOMING','ACTIVE')
        AND ((e.original_date BETWEEN ${lo}::date AND ${hi}::date)
          OR (e.kind='MOVE' AND e.replacement_starts_at<${end}::timestamptz AND e.replacement_ends_at>${start}::timestamptz))
    `;
    const exceptions = exceptionIds.length ? await tx.classScheduleException.findMany({ where: { ownerId: owner.id, id: { in: exceptionIds.map((row) => row.id) } } }) : [];
    return schedules.map((row) => ({ series: seriesFromRow(row), course: row.course,
      exceptions: exceptions.filter((exception) => exception.scheduleId === row.id).map((exception): OccurrenceException => ({ ...exception, originalDate: literalDate(exception.originalDate) })) }));
  }, { isolationLevel: "RepeatableRead" });
}
export async function timetableRange(prisma: PrismaClient, owner: AcademicOwner, start: Date, end: Date, termId?: unknown, includeCancelled = false): Promise<TimetableOccurrence[]> {
  if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 366 * 86400000) invalid("Choose a positive timetable interval of at most 366 days.");
  const candidates = await loadCandidates(prisma, owner, termId, start, end);
  return candidates.flatMap(({ series, exceptions, course }) => occurrencesInRange(series, exceptions, start, end, includeCancelled)
    .map((occurrence) => ({ ...occurrence, courseCode: course.courseCode, courseTitle: course.title }))).sort(compareOccurrences);
}
export async function todaysClasses(prisma: PrismaClient, owner: AcademicOwner, date: unknown, timezone: unknown, termId?: unknown) {
  const day = dateInput(date);
  const zone = zoneInput(timezone);
  const range = localDayRange(day, zone);
  if (range.end <= range.start) return []; // A skipped civil calendar day has no effective interval.
  return timetableRange(prisma, owner, range.start, range.end, termId);
}
export async function nextClass(prisma: PrismaClient, owner: AcademicOwner, now = new Date(), termId?: unknown): Promise<TimetableOccurrence | null> {
  if (!Number.isFinite(now.getTime())) invalid("Choose a valid current instant.");
  const candidates = await loadCandidates(prisma, owner, termId, now, new Date("9999-12-31T23:59:59.999Z"), true);
  const occurrences = candidates.flatMap(({ series, exceptions, course }) => {
    const next = nextOccurrence(series, exceptions, now);
    return next ? [{ ...next, courseCode: course.courseCode, courseTitle: course.title }] : [];
  });
  return occurrences.sort(compareOccurrences)[0] ?? null;
}
export async function selectedAcademicContext(prisma: PrismaClient, owner: AcademicOwner) {
  const profile = await prisma.profile.findUnique({ where: { ownerId: idInput(owner.id) } });
  if (!profile) throw new AcademicError("INVALID_STATE", "Complete your profile first.");
  const term = profile.selectedTermId ? await ownedTerm(prisma, owner, profile.selectedTermId) : null;
  return { profile, term: term?.archivedAt ? null : term, today: academicDate(new Date(), term?.academicTimezone ?? profile.timezone) };
}
