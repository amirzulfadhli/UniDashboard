import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/db/client";
import { withOwnerTransaction } from "../src/db/owner-transaction";
import { archiveCourse, createCourse, createTerm, selectTerm } from "../src/academic/records";
import { createSchedule, putException } from "../src/academic/schedules";
import { getDashboard, type Dashboard } from "../src/dashboard/queries";
import { archiveWork, createWork, workLifecycle } from "../src/work/service";
import { DashboardScreen } from "../src/app/home/dashboard-screen";
import DashboardError from "../src/app/home/error";

const db = createPrismaClient();
after(async () => db.$disconnect());
const now = new Date("2026-10-15T16:30:00Z"); // Oct 16 in Kuala Lumpur; Oct 15 in New York.
const termInput = { name: "Autumn term", startsOn: "2025-01-01", endsOn: "2027-12-31", teachingStartsOn: "2026-09-01", academicTimezone: "America/New_York" };
async function fixture(timezone = "Asia/Kuala_Lumpur") {
  const owner = await db.user.create({ data: {} });
  await db.profile.create({ data: { ownerId: owner.id, timezone, displayName: "Amina <script>alert(1)</script>" } });
  const term = await createTerm(db, owner, termInput);
  await selectTerm(db, owner, term.id);
  const course = await createCourse(db, owner, { termId: term.id, courseCode: "CS101", title: "Algorithms" });
  return { owner, term, course };
}
function ready(value: Awaited<ReturnType<typeof getDashboard>>): asserts value is Dashboard { assert.ok(value.ready); }
const schedule = { weekday: 5, localStartTime: "09:00", localEndTime: "10:00", endDayOffset: 0,
  timezone: "Asia/Kuala_Lumpur", originalStartDate: "2026-09-01", originalEndDate: "2026-12-31", location: "Room 2" };

test("dashboard preserves setup gates, validates owner/now and handles an empty workspace", async () => {
  const owner = await db.user.create({ data: {} });
  assert.deepEqual(await getDashboard(db, owner, now), { ready: false, destination: "/onboarding" });
  await assert.rejects(getDashboard(db, { id: "invalid" }, now), { code: "INVALID_INPUT" });
  await assert.rejects(getDashboard(db, owner, new Date(NaN)), { code: "INVALID_INPUT" });
  const a = await fixture();
  const empty = await getDashboard(db, a.owner, now); ready(empty);
  assert.equal(empty.taskCount, 0); assert.equal(empty.deadlineCount, 0); assert.deepEqual(empty.todayClasses, []);
  assert.equal(empty.currentClasses.length, 0); assert.equal(empty.nextClass, null);
  assert.equal(empty.today, "2026-10-16"); assert.equal(empty.term.teachingWeek, 7);
  await db.profile.update({ where: { ownerId: a.owner.id }, data: { selectedTermId: null } });
  assert.deepEqual(await getDashboard(db, a.owner, now), { ready: false, destination: "/terms" });
});

test("dashboard shares deadline semantics, ranks tasks, excludes terminal/archived/foreign work and retains historical context", async () => {
  const a = await fixture(), foreign = await fixture();
  const allDay = (dueDate: string, dueTimezone = "Asia/Kuala_Lumpur") => ({ deadlineKind: "DATE_ONLY", dueDate, dueTimezone });
  const overdue = await createWork(db, a.owner, "TASK", { title: "Old low priority", priority: "LOW", ...allDay("2026-10-15") });
  const sourceToday = await createWork(db, a.owner, "TASK", { title: "Source today", priority: "LOW", ...allDay("2026-10-15", "America/New_York") });
  const urgent = await createWork(db, a.owner, "TASK", { title: "Urgent no deadline", priority: "URGENT" });
  const high = await createWork(db, a.owner, "TASK", { title: "High priority to do", priority: "HIGH" });
  const inProgress = await createWork(db, a.owner, "TASK", { title: "High priority started", priority: "HIGH" });
  await workLifecycle(db, a.owner, "TASK", inProgress.id, "IN_PROGRESS");
  const timed = await createWork(db, a.owner, "ASSIGNMENT", { title: "Exactly now", courseId: a.course.id, deadlineKind: "TIMED", dueAt: now.toISOString(), dueTimezone: "America/New_York" });
  await createWork(db, a.owner, "PROJECT", { title: "One millisecond late", deadlineKind: "TIMED", dueAt: new Date(+now - 1).toISOString(), dueTimezone: "UTC" });
  await createWork(db, a.owner, "PROJECT", { title: "Beyond horizon", ...allDay("2026-11-16") });
  const done = await createWork(db, a.owner, "TASK", { title: "Done", ...allDay("2026-10-15") });
  await workLifecycle(db, a.owner, "TASK", done.id, "DONE");
  const archived = await createWork(db, a.owner, "PROJECT", { title: "Archived", ...allDay("2026-10-15") });
  await archiveWork(db, a.owner, "PROJECT", archived.id, true);
  await createWork(db, foreign.owner, "TASK", { title: "Foreign secret", ...allDay("2026-10-15") });
  await archiveCourse(db, a.owner, a.course.id, true);
  const result = await getDashboard(db, a.owner, now); ready(result);
  assert.equal(result.overdueCount, 2); assert.equal(result.dueTodayCount, 3); assert.equal(result.taskCount, 5);
  assert.deepEqual(result.tasks.map((row) => row.id), [overdue.id, sourceToday.id, urgent.id, inProgress.id, high.id]);
  assert.equal(result.deadlineCount, 4);
  assert.ok(!result.deadlines.some((row) => ["Foreign secret", "Done", "Archived", "Beyond horizon"].includes(row.title)));
  const today = result.tasks.find((row) => row.id === sourceToday.id)!;
  assert.equal(today.deadline?.date, "2026-10-15"); assert.equal(today.deadline?.time, null);
  assert.equal(today.deadline?.overdue, false); assert.equal(today.deadline?.dueToday, true);
  const instant = result.deadlines.find((row) => row.id === timed.id)!;
  assert.equal(instant.deadline?.date, "2026-10-16"); assert.equal(instant.deadline?.time, "00:30");
  assert.equal(instant.deadline?.sourceDate, "2026-10-15"); assert.equal(instant.deadline?.overdue, false);
  assert.equal(result.courseCount, 0);
});

test("today classes reuse MOVE/CANCEL, overnight overlap, selected term and viewer timezone", async () => {
  const a = await fixture();
  const overnight = await createSchedule(db, a.owner, { ...schedule, courseId: a.course.id, weekday: 4, localStartTime: "23:30", localEndTime: "01:00", endDayOffset: 1 });
  const moved = await createSchedule(db, a.owner, { ...schedule, courseId: a.course.id });
  const cancelled = await createSchedule(db, a.owner, { ...schedule, courseId: a.course.id });
  await putException(db, a.owner, cancelled.id, { kind: "CANCEL", originalDate: "2026-10-16" });
  await putException(db, a.owner, moved.id, { kind: "MOVE", originalDate: "2026-10-09", replacementStartDate: "2026-10-16", replacementStartTime: "11:00", replacementEndDate: "2026-10-16", replacementEndTime: "12:00", replacementTimezone: "Asia/Kuala_Lumpur" });
  const result = await getDashboard(db, a.owner, now); ready(result);
  assert.equal(result.todayClasses.length, 3); assert.equal(result.currentClasses.length, 1);
  assert.equal(result.currentClasses[0]!.identity.scheduleId, overnight.id);
  assert.equal(result.currentClasses[0]!.identity.originalDate, "2026-10-15");
  assert.equal(result.todayClasses.filter((item) => item.identity.originalDate === "2026-10-09")[0]!.occurrenceState, "MOVED");
  assert.ok(result.todayClasses.every((item) => item.identity.scheduleId !== cancelled.id));
  assert.equal(result.nextClass?.viewerStartTime, "09:00");
  const other = await createTerm(db, a.owner, { ...termInput, name: "Other" }); await selectTerm(db, a.owner, other.id);
  const changed = await getDashboard(db, a.owner, now); ready(changed); assert.equal(changed.todayClasses.length, 0);
});

test("DST fall-back keeps viewer date, earlier ambiguous instant and current/next boundaries", async () => {
  const a = await fixture("America/New_York");
  await createSchedule(db, a.owner, { ...schedule, courseId: a.course.id, timezone: "America/New_York", weekday: 7, originalStartDate: "2026-11-01", originalEndDate: "2026-11-01", localStartTime: "01:30", localEndTime: "03:00" });
  const before = await getDashboard(db, a.owner, new Date("2026-11-01T05:29:59Z")); ready(before);
  assert.equal(before.today, "2026-11-01"); assert.equal(before.nextClass?.startsAt.toISOString(), "2026-11-01T05:30:00.000Z");
  const during = await getDashboard(db, a.owner, new Date("2026-11-01T06:30:00Z")); ready(during);
  assert.equal(during.currentClasses.length, 1); assert.equal(during.todayClasses[0]!.viewerStartTime, "01:30");
  assert.equal(during.nextClass, null);
});

test("timed dashboard deadlines and task ties follow instants through repeated hours and sub-minute differences", async () => {
  const a = await fixture("America/New_York");
  const at = new Date("2026-11-01T04:00:00Z");
  const earlier = await createWork(db, a.owner, "TASK", { title: "Earlier 01:50", priority: "HIGH", deadlineKind: "TIMED", dueAt: "2026-11-01T05:50:00Z", dueTimezone: "UTC" });
  const later = await createWork(db, a.owner, "TASK", { title: "Later 01:10", priority: "HIGH", deadlineKind: "TIMED", dueAt: "2026-11-01T06:10:00Z", dueTimezone: "UTC" });
  const last = await createWork(db, a.owner, "TASK", { title: "Sub-minute later", priority: "HIGH", deadlineKind: "TIMED", dueAt: "2026-11-01T07:00:00.900Z", dueTimezone: "UTC" });
  const first = await createWork(db, a.owner, "TASK", { title: "Sub-minute earlier", priority: "HIGH", deadlineKind: "TIMED", dueAt: "2026-11-01T07:00:00.100Z", dueTimezone: "UTC" });
  const allDay = await createWork(db, a.owner, "PROJECT", { title: "Literal all day", deadlineKind: "DATE_ONLY", dueDate: "2026-11-01", dueTimezone: "UTC" });
  const result = await getDashboard(db, a.owner, at); ready(result);
  assert.deepEqual(result.tasks.map((item) => item.id), [earlier.id, later.id, first.id, last.id]);
  assert.deepEqual(result.deadlines.map((item) => item.id), [allDay.id, earlier.id, later.id, first.id, last.id]);
  assert.equal(result.deadlines[0]!.deadline?.time, null);
  assert.equal(result.tasks[0]!.deadline?.time, "01:50");
  assert.equal(result.tasks[1]!.deadline?.time, "01:10");
});

test("large active workspaces keep exact counts and shortlists without expiring the snapshot", async () => {
  const a = await fixture();
  const total = 5000;
  for (let offset = 0; offset < total; offset += 500) await db.task.createMany({ data: Array.from({ length: 500 }, (_, index) => {
    const i = offset + index;
    return { ownerId: a.owner.id, title: `Volume ${i}`, description: "Long work details. ".repeat(450), priority: "HIGH" as const,
      deadlineKind: "TIMED" as const, dueAt: new Date(+now + ((i * 7919) % total) * 1000), dueTimezone: "America/New_York" };
  }) });
  await db.project.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ ownerId: a.owner.id, title: `Project ${i}`, deadlineKind: "DATE_ONLY" as const, dueDate: new Date("2026-10-15T00:00:00Z"), dueTimezone: "Asia/Kuala_Lumpur" })) });
  await db.assignment.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ ownerId: a.owner.id, courseId: a.course.id, title: `Assignment ${i}`, deadlineKind: "DATE_ONLY" as const, dueDate: new Date("2026-10-16T00:00:00Z"), dueTimezone: "UTC" })) });
  const result = await getDashboard(db, a.owner, now); ready(result);
  assert.equal(result.taskCount, total);
  assert.equal(result.deadlineCount, total + 500);
  assert.equal(result.overdueCount, 250);
  assert.equal(result.dueTodayCount, total);
  assert.equal(result.tasks.length, 5); assert.equal(result.deadlines.length, 6);
  assert.equal(result.tasks[0]!.title, "Volume 0");
  assert.ok(result.deadlines.every((item) => item.kind === "PROJECT"));
  const repeat = await getDashboard(db, a.owner, now); ready(repeat);
  assert.deepEqual(result.tasks, repeat.tasks);
});

test("dashboard retry requests a fresh server page rather than replaying a failed server payload", () => {
  const html = renderToStaticMarkup(createElement(DashboardError));
  assert.match(html, /<a[^>]*href="\/home"[^>]*>Try again<\/a>/);
  assert.ok(html.includes("Open work"));
});

test("one snapshot keeps profile, classes and work coherent during an interleaved mutation", async () => {
  const a = await fixture(); await createSchedule(db, a.owner, { ...schedule, courseId: a.course.id });
  const task = await createWork(db, a.owner, "TASK", { title: "Snapshot task" });
  let changed = false;
  const interleaved = new Proxy(db, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction((tx) => callback(new Proxy(tx, { get(transaction, property) {
      if (property !== "classSchedule") return Reflect.get(transaction, property);
      return new Proxy(transaction.classSchedule, { get(delegate, method) {
        if (method !== "findMany") return Reflect.get(delegate, method);
        return async (args: object) => { const rows = await delegate.findMany(args); if (!changed) {
          changed = true;
          await withOwnerTransaction(db, a.owner.id, async (write) => {
            await write.profile.update({ where: { ownerId: a.owner.id }, data: { timezone: "UTC" } });
            await write.task.update({ where: { id: task.id }, data: { status: "DONE", statusChangedAt: now, lastCompletedAt: now } });
          });
        } return rows; };
      } });
    } })), options);
  } }) as PrismaClient;
  const result = await getDashboard(interleaved, a.owner, now); ready(result);
  assert.ok(changed); assert.equal(result.timezone, "Asia/Kuala_Lumpur"); assert.equal(result.today, "2026-10-16");
  assert.ok(result.tasks.some((row) => row.id === task.id)); assert.equal(result.todayClasses.length, 1);
  const after = await getDashboard(db, a.owner, now); ready(after);
  assert.equal(after.timezone, "UTC"); assert.ok(!after.tasks.some((row) => row.id === task.id));
});

test("dashboard query count stays constant as cards grow; result limits and stable ordering hold", async () => {
  const a = await fixture();
  await createWork(db, a.owner, "TASK", { title: "First", priority: "HIGH" });
  const connection = new URL(process.env.DATABASE_URL!); connection.searchParams.set("options", "-c TimeZone=UTC");
  const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.toString() }), log: [{ emit: "event", level: "query" }] });
  let count = 0; measured.$on("query", () => { count++; });
  try {
    await getDashboard(measured, a.owner, now); const small = count; count = 0;
    for (let i = 0; i < 24; i++) await createWork(db, a.owner, "TASK", { title: `Task ${i}`, priority: "HIGH" });
    const result = await getDashboard(measured, a.owner, now); ready(result);
    assert.equal(count, small); assert.equal(result.taskCount, 25); assert.equal(result.tasks.length, 5);
    const repeat = await getDashboard(measured, a.owner, now); ready(repeat);
    assert.deepEqual(result.tasks, repeat.tasks);
    console.log(`dashboard SQL queries=${small} for 1 and 25 tasks`);
  } finally { await measured.$disconnect(); }
});

test("dashboard renders safe content, actionable empty states, navigation and literal all-day labels", async () => {
  const a = await fixture(); const empty = await getDashboard(db, a.owner, now); ready(empty);
  const html = renderToStaticMarkup(createElement(DashboardScreen, { dashboard: empty }));
  assert.ok(html.includes("A little breathing room") && html.includes("A fresh page") && html.includes("Nothing pressing"));
  assert.ok(html.includes('aria-current="page"') && html.includes('href="#dashboard-main"'));
  assert.ok(html.includes('href="/work?create=TASK#new-task"'));
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>alert(1)</script>"));
  const task = await createWork(db, a.owner, "TASK", { title: "<img src=x onerror=alert(1)>", deadlineKind: "DATE_ONLY", dueDate: "2026-10-16", dueTimezone: "Asia/Kuala_Lumpur" });
  const rich = await getDashboard(db, a.owner, now); ready(rich);
  const rendered = renderToStaticMarkup(createElement(DashboardScreen, { dashboard: rich }));
  assert.ok(rendered.includes('href="/work#work-' + task.id + '"'));
  assert.ok(rendered.includes("All day") && rendered.includes("Asia/Kuala_Lumpur") && rendered.includes("Due today"));
  assert.ok(rendered.includes("&lt;img") && !rendered.includes("<img src=x"));
  const longName = "W".repeat(100);
  const longNameHtml = renderToStaticMarkup(createElement(DashboardScreen, { dashboard: { ...rich, displayName: longName } }));
  assert.ok(longNameHtml.includes(`, ${longName}<span class="dash-heading-dot">`), "the full name stays available for wrapping");
});
