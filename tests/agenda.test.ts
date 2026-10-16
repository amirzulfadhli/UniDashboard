import assert from "node:assert/strict";
import { after, test } from "node:test";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/db/client";
import { withOwnerTransaction } from "../src/db/owner-transaction";
import { AcademicError } from "../src/academic/errors";
import { archiveCourse, archiveTerm, courseLifecycle, createCourse, createTerm, selectTerm, termLifecycle } from "../src/academic/records";
import { createSchedule, putException, splitSchedule } from "../src/academic/schedules";
import { getAgendaForDay, getAgendaForRange, getTodayAgenda, getTomorrowAgenda, getUpcomingAgenda, getWeekAgenda } from "../src/agenda/queries";
import { isTimedWork } from "../src/agenda/temporal";
import { archiveWork, createWork, workLifecycle } from "../src/work/service";
import type { AgendaItem } from "../src/agenda/types";

const prisma = createPrismaClient();
after(async () => prisma.$disconnect());
const now = new Date("2026-10-15T07:00:00Z");
const code = (expected: string) => (error: unknown) => error instanceof AcademicError && error.code === expected;
const scheduleData = { weekday: 1, localStartTime: "09:00", localEndTime: "10:00", endDayOffset: 0, timezone: "Asia/Kuala_Lumpur",
  originalStartDate: "2026-09-01", originalEndDate: "2026-12-31", location: "Room A" };
async function fixture(timezone = "Asia/Kuala_Lumpur") {
  const owner = await prisma.user.create({ data: {} });
  await prisma.profile.create({ data: { ownerId: owner.id, timezone } });
  const term = await createTerm(prisma, owner, { name: "Selected term", startsOn: "2026-09-01", endsOn: "2026-12-31", teachingStartsOn: "2026-09-01", academicTimezone: "Asia/Kuala_Lumpur" });
  await selectTerm(prisma, owner, term.id);
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "AGENDA101", title: "Agenda course" });
  return { owner, term, course };
}
const items = (agenda: Awaited<ReturnType<typeof getAgendaForDay>>): AgendaItem[] => agenda.days.flatMap((day) => day.items);

test("academic composition keeps effective MOVE/CANCEL, split history, overnight overlap and selected Term visibility", async () => {
  const a = await fixture();
  const schedule = await createSchedule(prisma, a.owner, { ...scheduleData, courseId: a.course.id });
  const overnight = await createSchedule(prisma, a.owner, { ...scheduleData, localStartTime: "23:30", localEndTime: "01:00", endDayOffset: 1, courseId: a.course.id });
  await putException(prisma, a.owner, schedule.id, { kind: "CANCEL", originalDate: "2026-09-28" });
  await putException(prisma, a.owner, schedule.id, { kind: "MOVE", originalDate: "2026-09-21", replacementStartDate: "2026-10-06", replacementStartTime: "11:00", replacementEndDate: "2026-10-06", replacementEndTime: "12:00", replacementTimezone: "Asia/Kuala_Lumpur", replacementLocation: "Moved in" });
  await putException(prisma, a.owner, schedule.id, { kind: "MOVE", originalDate: "2026-10-05", replacementStartDate: "2026-10-07", replacementStartTime: "11:00", replacementEndDate: "2026-10-07", replacementEndTime: "12:00", replacementTimezone: "Asia/Kuala_Lumpur", replacementLocation: "Moved out" });
  const successor = await splitSchedule(prisma, a.owner, schedule.id, "2026-10-12", { ...scheduleData, weekday: 2, localStartTime: "10:00", localEndTime: "11:00", courseId: a.course.id }, new Date("2026-09-20T00:00:00Z"));
  const options = { now: new Date("2026-10-05T16:30:00Z") };
  assert.ok(!items(await getAgendaForDay(prisma, a.owner, "2026-09-28", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id && item.identity.originalDate === "2026-09-28"));
  assert.ok(!items(await getAgendaForDay(prisma, a.owner, "2026-10-05", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id && item.identity.originalDate === "2026-10-05"));
  const movedIn = await getAgendaForDay(prisma, a.owner, "2026-10-06", options);
  assert.ok(items(movedIn).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id && item.identity.originalDate === "2026-09-21" && item.occurrenceState === "MOVED"));
  assert.ok(items(movedIn).some((item) => item.kind === "CLASS" && item.identity.scheduleId === overnight.id && item.identity.originalDate === "2026-10-05" && item.position === "CURRENT"));
  const overnightRange = await getAgendaForRange(prisma, a.owner, "2026-10-05", "2026-10-06", options);
  assert.deepEqual(overnightRange.days.map((day) => day.items.filter((item) => item.kind === "CLASS" && item.identity.scheduleId === overnight.id && item.identity.originalDate === "2026-10-05").length), [1, 1]);
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-07", options)).some((item) => item.kind === "CLASS" && item.identity.originalDate === "2026-10-05" && item.occurrenceState === "MOVED"));
  assert.ok(!items(await getAgendaForDay(prisma, a.owner, "2026-10-12", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id));
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === successor.id));
  const otherTerm = await createTerm(prisma, a.owner, { name: "Other term", startsOn: "2026-09-01", endsOn: "2026-12-31", teachingStartsOn: "2026-09-01", academicTimezone: "UTC" });
  const otherCourse = await createCourse(prisma, a.owner, { termId: otherTerm.id, courseCode: "OTHER", title: "Other class" });
  await createSchedule(prisma, a.owner, { ...scheduleData, courseId: otherCourse.id });
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-19", options)).every((item) => item.kind !== "CLASS" || item.course.code !== "OTHER"));
  await selectTerm(prisma, a.owner, otherTerm.id);
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-19", options)).some((item) => item.kind === "CLASS" && item.course.code === "OTHER"));
  await selectTerm(prisma, a.owner, a.term.id);
  await archiveCourse(prisma, a.owner, a.course.id, true);
  assert.equal(items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).filter((item) => item.kind === "CLASS").length, 0);
  await archiveCourse(prisma, a.owner, a.course.id, false);
  await archiveTerm(prisma, a.owner, a.term.id, true);
  assert.equal(items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).filter((item) => item.kind === "CLASS").length, 0);
  await archiveTerm(prisma, a.owner, a.term.id, false);
  await selectTerm(prisma, a.owner, a.term.id);
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === successor.id));
  await termLifecycle(prisma, a.owner, a.term.id, "CLOSED");
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === successor.id), "Task 3 permits selected CLOSED Term class visibility");
  await courseLifecycle(prisma, a.owner, a.course.id, "COMPLETED");
  assert.ok(!items(await getAgendaForDay(prisma, a.owner, "2026-10-13", options)).some((item) => item.kind === "CLASS" && item.identity.scheduleId === successor.id));
});

test("all Task, Assignment and Project deadline variants compose without no-deadline or terminal work", async () => {
  const a = await fixture();
  const dateDeadline = { deadlineKind: "DATE_ONLY", dueDate: "2026-10-15", dueTimezone: "Asia/Kuala_Lumpur" };
  const timedDeadline = { deadlineKind: "TIMED", dueAt: "2026-10-15T08:00:00Z", dueTimezone: "Asia/Kuala_Lumpur" };
  const projectDate = await createWork(prisma, a.owner, "PROJECT", { title: "Project date", courseId: a.course.id, ...dateDeadline });
  const projectTimed = await createWork(prisma, a.owner, "PROJECT", { title: "Project timed", ...timedDeadline });
  const taskDate = await createWork(prisma, a.owner, "TASK", { title: "Task date", projectId: projectDate.id, ...dateDeadline });
  const taskTimed = await createWork(prisma, a.owner, "TASK", { title: "Task timed", projectId: projectDate.id, ...timedDeadline });
  const assignmentDate = await createWork(prisma, a.owner, "ASSIGNMENT", { title: "Assignment date", courseId: a.course.id, ...dateDeadline });
  const assignmentTimed = await createWork(prisma, a.owner, "ASSIGNMENT", { title: "Assignment timed", courseId: a.course.id, ...timedDeadline });
  await createWork(prisma, a.owner, "TASK", { title: "No deadline" });
  const first = await getAgendaForDay(prisma, a.owner, "2026-10-15", { now });
  const work = items(first).filter((item) => item.kind !== "CLASS");
  assert.equal(work.length, 6);
  assert.deepEqual(new Set(work.map((item) => item.kind)), new Set(["TASK_DEADLINE", "ASSIGNMENT_DEADLINE", "PROJECT_DEADLINE"]));
  assert.equal(work.filter((item) => item.deadline.kind === "DATE_ONLY").length, 3);
  assert.equal(work.filter((item) => item.deadline.kind === "TIMED").length, 3);
  assert.ok(work.some((item) => item.identity.workId === taskDate.id && item.project?.id === projectDate.id));
  assert.ok(work.some((item) => item.identity.workId === assignmentDate.id && item.course?.id === a.course.id));
  assert.ok(work.every((item) => item.deadline.kind !== "DATE_ONLY" || item.deadline.classification === "DUE_TODAY"));
  await workLifecycle(prisma, a.owner, "TASK", taskDate.id, "DONE");
  await workLifecycle(prisma, a.owner, "ASSIGNMENT", assignmentDate.id, "CANCELLED");
  await archiveWork(prisma, a.owner, "PROJECT", projectDate.id, true);
  assert.deepEqual(new Set(items(await getAgendaForDay(prisma, a.owner, "2026-10-15", { now })).filter((item) => item.kind !== "CLASS").map((item) => item.identity.workId)), new Set([taskTimed.id, assignmentTimed.id, projectTimed.id]));
  await workLifecycle(prisma, a.owner, "TASK", taskDate.id, "TODO");
  await workLifecycle(prisma, a.owner, "ASSIGNMENT", assignmentDate.id, "NOT_STARTED");
  await archiveWork(prisma, a.owner, "PROJECT", projectDate.id, false);
  await archiveCourse(prisma, a.owner, a.course.id, true);
  assert.equal(items(await getAgendaForDay(prisma, a.owner, "2026-10-15", { now })).filter((item) => item.kind !== "CLASS").length, 6, "general work remains visible under archived academic context");
  await archiveCourse(prisma, a.owner, a.course.id, false);
  await archiveWork(prisma, a.owner, "PROJECT", projectDate.id, true);
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-15", { now })).some((item) => item.kind === "TASK_DEADLINE" && item.identity.workId === taskTimed.id && item.project?.id === projectDate.id));
  const otherTerm = await createTerm(prisma, a.owner, { name: "Other selected Term", startsOn: "2026-09-01", endsOn: "2026-12-31", teachingStartsOn: "2026-09-01", academicTimezone: "UTC" });
  await selectTerm(prisma, a.owner, otherTerm.id);
  assert.ok(items(await getAgendaForDay(prisma, a.owner, "2026-10-15", { now })).some((item) => item.kind === "ASSIGNMENT_DEADLINE" && item.identity.workId === assignmentTimed.id), "selected Term does not hide general work deadlines");
});

test("Profile timezone controls day/week grouping while source deadline zone controls due classification", async () => {
  const a = await fixture("America/New_York");
  const date = await createWork(prisma, a.owner, "TASK", { title: "Source date", deadlineKind: "DATE_ONLY", dueDate: "2026-10-16", dueTimezone: "Asia/Kuala_Lumpur" });
  const timed = await createWork(prisma, a.owner, "PROJECT", { title: "Source instant", deadlineKind: "TIMED", dueAt: "2026-10-15T16:00:00Z", dueTimezone: "Asia/Kuala_Lumpur" });
  const fixed = new Date("2026-10-15T16:00:00Z");
  const today = await getTodayAgenda(prisma, a.owner, { now: fixed });
  assert.equal(today.startDate, "2026-10-15");
  assert.ok(items(today).some((item) => item.kind === "PROJECT_DEADLINE" && isTimedWork(item) && item.identity.workId === timed.id && item.viewerTime === "12:00" && item.deadline.dueToday));
  const tomorrow = await getTomorrowAgenda(prisma, a.owner, { now: fixed });
  assert.equal(tomorrow.startDate, "2026-10-16");
  assert.ok(items(tomorrow).some((item) => item.kind === "TASK_DEADLINE" && item.identity.workId === date.id && item.deadline.kind === "DATE_ONLY" && item.deadline.classification === "DUE_TODAY"));
  const week = await getWeekAgenda(prisma, a.owner, { now: fixed });
  assert.deepEqual([week.startDate, week.endDate, week.days.length], ["2026-10-12", "2026-10-18", 7]);
  const range = await getUpcomingAgenda(prisma, a.owner, "2026-10-15", "2026-10-16", { now: fixed });
  assert.equal(range.returnedItems, 2);
  await assert.rejects(getAgendaForRange(prisma, a.owner, "2026-01-01", "2027-01-02", { now: fixed }), code("INVALID_INPUT"));
});

test("service accepts 366 New York calendar dates across fall-back and bounds class expansion", async () => {
  const a = await fixture("America/New_York");
  const schedule = await createSchedule(prisma, a.owner, { ...scheduleData, courseId: a.course.id });
  const range = await getAgendaForRange(prisma, a.owner, "2025-11-01", "2026-11-01", { now });
  assert.equal(range.viewerTimezone, "America/New_York");
  assert.equal(range.days.length, 366);
  assert.ok(range.expandedClassOccurrences > 0);
  assert.ok(items(range).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id));
  await assert.rejects(getAgendaForRange(prisma, a.owner, "2025-11-01", "2026-11-02", { now }), code("INVALID_INPUT"));
});

test("owner isolation and foreign Term context are enforced for combined sources", async () => {
  const a = await fixture(), b = await fixture();
  const schedule = await createSchedule(prisma, b.owner, { ...scheduleData, courseId: b.course.id });
  const task = await createWork(prisma, b.owner, "TASK", { title: "Foreign deadline", deadlineKind: "DATE_ONLY", dueDate: "2026-10-19", dueTimezone: "UTC" });
  const aView = await getAgendaForDay(prisma, a.owner, "2026-10-19", { now });
  assert.ok(!items(aView).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id));
  assert.ok(!items(aView).some((item) => item.kind !== "CLASS" && item.identity.workId === task.id));
  await assert.rejects(getAgendaForDay(prisma, a.owner, "2026-10-19", { now, termId: b.term.id }), code("NOT_FOUND"));
  await assert.rejects(getAgendaForDay(prisma, a.owner, "2026-10-19", { now, termId: "bad-id" }), code("INVALID_INPUT"));
  const forged = await getAgendaForDay(prisma, a.owner, "2026-10-19", { now, ownerId: b.owner.id, userId: b.owner.id } as never);
  assert.deepEqual(forged, aView);
});

test("one repeatable-read agenda snapshot resists a write between timetable and work reads", async () => {
  const a = await fixture();
  const schedule = await createSchedule(prisma, a.owner, { ...scheduleData, courseId: a.course.id });
  const task = await createWork(prisma, a.owner, "TASK", { title: "Snapshot deadline", deadlineKind: "DATE_ONLY", dueDate: "2026-10-19", dueTimezone: "UTC" });
  let changed = false;
  const interleaved = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, property) {
      if (property !== "classSchedule") return Reflect.get(transaction, property);
      return new Proxy(transaction.classSchedule, { get(delegate, method) {
        if (method !== "findMany") return Reflect.get(delegate, method);
        return async (args: object) => { const rows = await delegate.findMany(args); if (!changed) {
          changed = true;
          await withOwnerTransaction(prisma, a.owner.id, async (write) => {
            const evidence = new Date();
            await write.course.update({ where: { id: a.course.id }, data: { archivedAt: evidence } });
            await write.task.update({ where: { id: task.id }, data: { status: "DONE", statusChangedAt: evidence, lastCompletedAt: evidence } });
          });
        } return rows; };
      } });
    } })), options);
  } }) as PrismaClient;
  const coherent = await getAgendaForDay(interleaved, a.owner, "2026-10-19", { now });
  assert.ok(changed);
  assert.ok(items(coherent).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id));
  assert.ok(items(coherent).some((item) => item.kind === "TASK_DEADLINE" && item.identity.workId === task.id));
  const after = await getAgendaForDay(prisma, a.owner, "2026-10-19", { now });
  assert.ok(!items(after).some((item) => item.kind === "CLASS" && item.identity.scheduleId === schedule.id));
  assert.ok(!items(after).some((item) => item.kind === "TASK_DEADLINE" && item.identity.workId === task.id));
});

test("representative agenda seed reports execution time, SQL queries, expansion and returned items", async () => {
  const a = await fixture();
  await createSchedule(prisma, a.owner, { ...scheduleData, courseId: a.course.id });
  for (let index = 0; index < 6; index++) await createWork(prisma, a.owner, "TASK", { title: `Measured ${index}`, deadlineKind: "DATE_ONLY", dueDate: "2026-10-19", dueTimezone: "UTC" });
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("options", "-c TimeZone=UTC");
  const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [{ emit: "event", level: "query" }] });
  let sqlQueries = 0;
  measured.$on("query", () => { sqlQueries++; });
  try {
    const start = performance.now();
    const result = await getAgendaForRange(measured, a.owner, "2026-10-19", "2026-10-25", { now });
    const elapsedMs = performance.now() - start;
    assert.ok(result.expandedClassOccurrences >= 1 && result.returnedItems >= 7 && sqlQueries > 0);
    console.log(`agenda baseline: elapsed_ms=${elapsedMs.toFixed(1)} sql_queries=${sqlQueries} expanded_classes=${result.expandedClassOccurrences} returned_items=${result.returnedItems}`);
  } finally { await measured.$disconnect(); }
});
