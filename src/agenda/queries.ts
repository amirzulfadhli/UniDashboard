import { Temporal } from "@js-temporal/polyfill";
import type { PrismaClient } from "../generated/prisma/client";
import { AcademicError, invalid } from "../academic/errors";
import { expandTimetableCandidates, loadTimetableCandidates } from "../academic/queries";
import { academicDate, overlaps } from "../academic/recurrence";
import type { AcademicOwner, AcademicTx } from "../academic/records";
import { idInput, literalDate } from "../academic/validation";
import { deadlineFacts, loadAgendaWorkCandidates } from "../work/queries";
import { agendaIdentity, classPosition, compareAgendaItems, pointPosition, tomorrowDate, viewerStamp, viewerToday, viewerWindow, weekDates } from "./temporal";
import type { AgendaItem, AgendaResult, ClassAgendaItem, CourseSummary, WorkAgendaItem } from "./types";

type Request = { view: "DAY"; date: unknown } | { view: "TODAY" } | { view: "TOMORROW" } | { view: "WEEK" }
  | { view: "RANGE"; startDate: unknown; endDate: unknown }
  | { view: "UPCOMING"; startDate?: unknown; endDate?: unknown };
export type AgendaOptions = { now?: Date; termId?: unknown };
type DeadlineSource = { id: string; title: string; status: string; deadlineKind: "NONE" | "DATE_ONLY" | "TIMED"; dueDate: Date | null; dueAt: Date | null; dueTimezone: string | null };

function requestedDates(request: Request, now: Date, zone: string) {
  if (request.view === "DAY") return { startDate: request.date, endDate: request.date };
  if (request.view === "RANGE") return { startDate: request.startDate, endDate: request.endDate };
  if (request.view === "TODAY") { const date = viewerToday(now, zone); return { startDate: date, endDate: date }; }
  if (request.view === "TOMORROW") { const date = tomorrowDate(now, zone); return { startDate: date, endDate: date }; }
  if (request.view === "WEEK") return weekDates(now, zone);
  if (request.startDate === undefined && request.endDate === undefined) {
    const today = viewerToday(now, zone);
    return { startDate: today, endDate: Temporal.PlainDate.from(today).add({ days: 30 }).toString() };
  }
  if (request.startDate === undefined || request.endDate === undefined) invalid("Supply both agenda range dates.");
  return { startDate: request.startDate, endDate: request.endDate };
}
function courseSummary(course: { id: string; courseCode: string; title: string }): CourseSummary {
  return { id: course.id, code: course.courseCode, title: course.title };
}
function workProjection(kind: WorkAgendaItem["kind"], row: DeadlineSource, now: Date, viewerZone: string,
  context: { course?: CourseSummary; project?: { id: string; title: string }; assignment?: { id: string; title: string } }): WorkAgendaItem | null {
  const facts = deadlineFacts(row, now);
  if (!facts || !row.dueTimezone) return null;
  const base = { kind, identity: { workId: row.id }, title: row.title, lifecycle: row.status, ...context };
  if (row.deadlineKind === "DATE_ONLY") {
    const date = literalDate(row.dueDate!);
    return { ...base, viewerDate: date,
      deadline: { kind: "DATE_ONLY", date, timezone: row.dueTimezone,
        classification: facts.overdue ? "OVERDUE" : facts.dueToday ? "DUE_TODAY" : "UPCOMING" } };
  }
  if (row.deadlineKind !== "TIMED") return null;
  const at = row.dueAt!, local = viewerStamp(at, viewerZone);
  return { ...base, viewerDate: local.date, viewerTime: local.time,
    deadline: { kind: "TIMED", at, timezone: row.dueTimezone, sourceDate: facts.sourceDueDate,
      dueToday: facts.dueToday, overdue: facts.overdue }, position: pointPosition(at, now) };
}
async function readAgenda(prisma: PrismaClient, owner: AcademicOwner, request: Request, options: AgendaOptions = {}): Promise<AgendaResult> {
  const now = options.now ?? new Date();
  const snapshot = await prisma.$transaction((tx) => loadAgendaSnapshot(tx, owner, request, { ...options, now }), { isolationLevel: "RepeatableRead" });
  return projectAgenda(snapshot, now);
}
/** Compose with other reads inside the caller's repeatable-read snapshot. */
export async function loadAgendaSnapshot(tx: AcademicTx, owner: AcademicOwner, request: Request, options: AgendaOptions = {}) {
  idInput(owner.id);
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid("Choose a valid current instant.");
  const profile = await tx.profile.findUnique({ where: { ownerId: owner.id } });
  if (!profile) throw new AcademicError("INVALID_STATE", "Complete your profile first.");
  const dates = requestedDates(request, now, profile.timezone);
  const window = viewerWindow(dates.startDate, dates.endDate, profile.timezone);
  const academic = await loadTimetableCandidates(tx, owner, options.termId, window.start, window.end);
  const work = await loadAgendaWorkCandidates(tx, owner, window.startDate, window.endDate, window.start, window.end);
  return { viewerTimezone: profile.timezone, window, academic, work };
}
/** Pure projection stays outside the read transaction, including for composed views. */
export function projectAgenda(snapshot: Awaited<ReturnType<typeof loadAgendaSnapshot>>, now: Date): AgendaResult {
  const { viewerTimezone, window, academic, work } = snapshot;
  const occurrences = expandTimetableCandidates(academic, window.start, window.end);
  const byDate = new Map(window.days.map((day) => [day.date, day]));
  const seen = new Map(window.days.map((day) => [day.date, new Set<string>()]));
  for (const occurrence of occurrences) {
    if (occurrence.state === "CANCELLED") continue;
    const start = viewerStamp(occurrence.startsAt, viewerTimezone), end = viewerStamp(occurrence.endsAt, viewerTimezone);
    const item: ClassAgendaItem = { kind: "CLASS", identity: { scheduleId: occurrence.scheduleId, originalDate: occurrence.originalDate },
      title: occurrence.courseTitle, course: { id: occurrence.courseId, code: occurrence.courseCode, title: occurrence.courseTitle },
      occurrenceState: occurrence.state, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt,
      effectiveTimezone: occurrence.timezone, viewerStartDate: start.date, viewerStartTime: start.time,
      viewerEndDate: end.date, viewerEndTime: end.time, location: occurrence.location,
      position: classPosition(occurrence.startsAt, occurrence.endsAt, now) };
    const first = start.date > window.startDate ? start.date : window.startDate;
    const lastOverlap = academicDate(new Date(occurrence.endsAt.getTime() - 1), viewerTimezone);
    const last = lastOverlap < window.endDate ? lastOverlap : window.endDate;
    for (let date = first; date <= last; date = Temporal.PlainDate.from(date).add({ days: 1 }).toString()) {
      const day = byDate.get(date), identities = seen.get(date);
      if (day && identities && overlaps(occurrence, day.startAt, day.endAt) && !identities.has(agendaIdentity(item))) {
        day.items.push(item); identities.add(agendaIdentity(item));
      }
    }
  }
  const addWork = (item: WorkAgendaItem | null) => { if (item) byDate.get(item.viewerDate)?.items.push(item); };
  for (const row of work.tasks) addWork(workProjection("TASK_DEADLINE", row, now, viewerTimezone, {
    ...(row.course || row.assignment?.course ? { course: courseSummary(row.course ?? row.assignment!.course) } : {}),
    ...(row.project ? { project: { id: row.project.id, title: row.project.title } } : {}),
    ...(row.assignment ? { assignment: { id: row.assignment.id, title: row.assignment.title } } : {}),
  }));
  for (const row of work.projects) addWork(workProjection("PROJECT_DEADLINE", row, now, viewerTimezone, {
    ...(row.course ? { course: courseSummary(row.course) } : {}), project: { id: row.id, title: row.title },
  }));
  for (const row of work.assignments) addWork(workProjection("ASSIGNMENT_DEADLINE", row, now, viewerTimezone, { course: courseSummary(row.course) }));
  for (const day of window.days) day.items.sort((a: AgendaItem, b: AgendaItem) => compareAgendaItems(a, b, day.startAt));
  return { viewerTimezone, startDate: window.startDate, endDate: window.endDate, days: window.days,
    expandedClassOccurrences: occurrences.length, returnedItems: window.days.reduce((count, day) => count + day.items.length, 0) };
}
export const getAgendaForDay = (prisma: PrismaClient, owner: AcademicOwner, date: unknown, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "DAY", date }, options);
export const getTodayAgenda = (prisma: PrismaClient, owner: AcademicOwner, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "TODAY" }, options);
export const getTomorrowAgenda = (prisma: PrismaClient, owner: AcademicOwner, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "TOMORROW" }, options);
export const getWeekAgenda = (prisma: PrismaClient, owner: AcademicOwner, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "WEEK" }, options);
export const getAgendaForRange = (prisma: PrismaClient, owner: AcademicOwner, startDate: unknown, endDate: unknown, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "RANGE", startDate, endDate }, options);
export const getUpcomingAgenda = (prisma: PrismaClient, owner: AcademicOwner, startDate?: unknown, endDate?: unknown, options?: AgendaOptions) => readAgenda(prisma, owner, { view: "UPCOMING", startDate, endDate }, options);
