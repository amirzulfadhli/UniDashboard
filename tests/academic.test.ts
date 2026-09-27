import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/db/client";
import { withOwnerTransaction } from "../src/db/owner-transaction";
import { AcademicError } from "../src/academic/errors";
import { archiveCourse, archiveTerm, courseLifecycle, createCourse, createTerm, listCourses, listTerms, ownedCourse, ownedTerm, selectTerm, termLifecycle, updateCourse, updateTerm } from "../src/academic/records";
import { createSchedule, listSchedules, ownedSchedule, putException, removeException, retireSchedule, seriesFromRow, splitSchedule } from "../src/academic/schedules";
import { nextClass, timetableRange, todaysClasses } from "../src/academic/queries";
import { originalOccurrence } from "../src/academic/recurrence";

const prisma = createPrismaClient();
after(async () => prisma.$disconnect());
const termData = { name: "Autumn", startsOn: "2026-09-01", endsOn: "2026-12-31", teachingStartsOn: "2026-09-07", academicTimezone: "Asia/Kuala_Lumpur" };
const recurrence = { weekday: 1, localStartTime: "09:00", localEndTime: "10:00", endDayOffset: 0, timezone: "Asia/Kuala_Lumpur", originalStartDate: "2026-09-01", originalEndDate: "2026-12-31", location: "Room A" };
const now = new Date("2026-09-27T00:00Z");
async function fixture() {
  const owner = await prisma.user.create({ data: {} });
  await prisma.profile.create({ data: { ownerId: owner.id, timezone: "UTC" } });
  const term = await createTerm(prisma, owner, termData);
  await selectTerm(prisma, owner, term.id);
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "CS101", title: "Computing" });
  const schedule = await createSchedule(prisma, owner, { ...recurrence, courseId: course.id });
  return { owner, term, course, schedule };
}
function code(expected: string) { return (error: unknown) => error instanceof AcademicError && error.code === expected; }
const moveData = { kind: "MOVE", originalDate: "2026-09-28", replacementStartDate: "2026-09-30", replacementStartTime: "15:00", replacementEndDate: "2026-09-30", replacementEndTime: "16:00", replacementTimezone: "Asia/Kuala_Lumpur", replacementLocation: "Room B" };

test("Term/Course lifecycle evidence, literal dates, selection, archives, and repeated codes", async () => {
  const { owner, term, course } = await fixture();
  assert.equal(term.startsOn.toISOString().slice(0, 10), termData.startsOn);
  const second = await createCourse(prisma, owner, { termId: term.id, courseCode: "CS101", title: "Repeated code" });
  assert.notEqual(second.id, course.id);
  await updateTerm(prisma, owner, term.id, { ...termData, name: "Renamed" });
  const closed = await termLifecycle(prisma, owner, term.id, "CLOSED");
  const reopened = await termLifecycle(prisma, owner, term.id, "ACTIVE");
  assert.equal(reopened.lastClosedAt?.getTime(), closed.lastClosedAt?.getTime());
  assert.ok(reopened.lastReopenedAt);
  await termLifecycle(prisma, owner, term.id, "PLANNED"); // No extra state machine beyond audited constraints.
  const completed = await courseLifecycle(prisma, owner, course.id, "COMPLETED");
  const active = await courseLifecycle(prisma, owner, course.id, "ACTIVE");
  assert.equal(active.lastCompletedAt?.getTime(), completed.lastCompletedAt?.getTime());
  assert.ok(active.lastReopenedAt);
  const cancelled = await courseLifecycle(prisma, owner, course.id, "CANCELLED");
  const reinstated = await courseLifecycle(prisma, owner, course.id, "ACTIVE");
  assert.ok(reinstated.lastReinstatedAt);
  assert.equal(reinstated.lastCancelledAt?.getTime(), cancelled.lastCancelledAt?.getTime());
  await archiveTerm(prisma, owner, term.id, true);
  assert.equal((await prisma.profile.findUniqueOrThrow({ where: { ownerId: owner.id } })).selectedTermId, null);
  assert.equal((await ownedCourse(prisma, owner, course.id)).archivedAt, null);
  assert.equal((await listTerms(prisma, owner)).length, 0);
  assert.equal((await listTerms(prisma, owner, true)).length, 1);
  await assert.rejects(selectTerm(prisma, owner, term.id), code("INVALID_STATE"));
  await archiveTerm(prisma, owner, term.id, false);
  await selectTerm(prisma, owner, term.id);
  await archiveCourse(prisma, owner, course.id, true);
  assert.equal((await listCourses(prisma, owner, term.id)).length, 1);
  assert.equal((await listCourses(prisma, owner, term.id, true)).length, 2);
  await archiveCourse(prisma, owner, course.id, false);
});
test("all academic reads and mutations resolve guessed IDs through trusted ownership", async () => {
  const a = await fixture(); const b = await fixture();
  const attempts = [
    () => ownedTerm(prisma, a.owner, b.term.id), () => updateTerm(prisma, a.owner, b.term.id, termData),
    () => selectTerm(prisma, a.owner, b.term.id), () => archiveTerm(prisma, a.owner, b.term.id, true), () => termLifecycle(prisma, a.owner, b.term.id, "ACTIVE"),
    () => listCourses(prisma, a.owner, b.term.id), () => ownedCourse(prisma, a.owner, b.course.id),
    () => createCourse(prisma, a.owner, { termId: b.term.id, courseCode: "X", title: "X" }),
    () => updateCourse(prisma, a.owner, b.course.id, { termId: a.term.id, courseCode: "X", title: "X" }),
    () => archiveCourse(prisma, a.owner, b.course.id, true), () => courseLifecycle(prisma, a.owner, b.course.id, "ACTIVE"),
    () => createSchedule(prisma, a.owner, { ...recurrence, courseId: b.course.id }),
    () => listSchedules(prisma, a.owner, b.course.id), () => ownedSchedule(prisma, a.owner, b.schedule.id),
    () => putException(prisma, a.owner, b.schedule.id, { kind: "CANCEL", originalDate: "2026-09-28" }),
    () => removeException(prisma, a.owner, b.schedule.id, "2026-09-28"),
    () => splitSchedule(prisma, a.owner, b.schedule.id, "2026-09-28", { ...recurrence, courseId: b.course.id }, now),
    () => retireSchedule(prisma, a.owner, b.schedule.id, "2026-09-28", now),
    () => timetableRange(prisma, a.owner, now, new Date("2026-10-01"), b.term.id),
    () => nextClass(prisma, a.owner, now, b.term.id), () => todaysClasses(prisma, a.owner, "2026-09-28", "UTC", b.term.id),
  ];
  for (const attempt of attempts) await assert.rejects(attempt(), code("NOT_FOUND"));
  const forged = { ownerId: b.owner.id, userId: b.owner.id };
  const term = await createTerm(prisma, a.owner, { ...termData, ...forged });
  assert.equal(term.ownerId, a.owner.id);
  const course = await createCourse(prisma, a.owner, { termId: term.id, courseCode: "X", title: "X", ...forged });
  assert.equal(course.ownerId, a.owner.id);
  const schedule = await createSchedule(prisma, a.owner, { ...recurrence, courseId: course.id, ...forged, predecessorId: b.schedule.id });
  assert.equal(schedule.ownerId, a.owner.id); assert.equal(schedule.predecessorId, null);
  const exception = await putException(prisma, a.owner, schedule.id, { kind: "CANCEL", originalDate: "2026-09-28", ...forged, scheduleId: b.schedule.id });
  assert.equal(exception.ownerId, a.owner.id); assert.equal(exception.scheduleId, schedule.id);
  const successor = await splitSchedule(prisma, a.owner, schedule.id, "2026-09-28", { ...recurrence, courseId: course.id, ...forged, predecessorId: b.schedule.id }, now);
  assert.equal(successor.ownerId, a.owner.id); assert.equal(successor.predecessorId, schedule.id);
  assert.equal((await ownedTerm(prisma, b.owner, b.term.id)).name, termData.name);
});
test("boundary validation rejects malformed dates/times/zones, impossible occurrences, and bad MOVE payload", async () => {
  const { owner, term, course, schedule } = await fixture();
  for (const data of [{ ...termData, name: "  " }, { ...termData, startsOn: "2026-02-30" }, { ...termData, academicTimezone: "No/Such" }, { ...termData, teachingStartsOn: "2027-01-01" }]) await assert.rejects(createTerm(prisma, owner, data), code("INVALID_INPUT"));
  for (const data of [{ ...recurrence, weekday: 0 }, { ...recurrence, localStartTime: "24:00" }, { ...recurrence, localEndTime: "08:00" }, { ...recurrence, endDayOffset: 2 }, { ...recurrence, timezone: "+08:00" }, { ...recurrence, originalEndDate: "2026-08-31" }, { ...recurrence, location: "   " }]) await assert.rejects(createSchedule(prisma, owner, { ...data, courseId: course.id }), code("INVALID_INPUT"));
  await assert.rejects(createCourse(prisma, owner, { termId: term.id, courseCode: " ", title: "X" }), code("INVALID_INPUT"));
  for (const originalDate of ["2026-09-29", "2026-08-31", "2027-01-04"]) await assert.rejects(putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate }), code("INVALID_INPUT"));
  await assert.rejects(putException(prisma, owner, schedule.id, { ...moveData, replacementEndTime: "14:00" }), code("INVALID_INPUT"));
  await assert.rejects(putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate: "2026-09-28", replacementTimezone: "UTC" }), code("INVALID_INPUT"));
  await assert.rejects(ownedSchedule(prisma, owner, "not-an-id"), code("INVALID_INPUT"));
  const gap = await createSchedule(prisma, owner, { ...recurrence, courseId: course.id, weekday: 7, timezone: "America/New_York", originalStartDate: "2026-03-01", originalEndDate: "2026-03-31", localStartTime: "02:30", localEndTime: "03:30" });
  await assert.rejects(putException(prisma, owner, gap.id, { kind: "CANCEL", originalDate: "2026-03-08" }), code("INVALID_INPUT"));
  await assert.rejects(putException(prisma, owner, schedule.id, { ...moveData, replacementStartDate: "2026-03-08", replacementEndDate: "2026-03-08", replacementStartTime: "02:30", replacementEndTime: "03:30", replacementTimezone: "America/New_York" }), code("INVALID_INPUT"));
});
test("effective day/next queries include moves from outside range, overnight, contexts, archives and lifecycle", async () => {
  const { owner, term, course, schedule } = await fixture();
  const monday = await todaysClasses(prisma, owner, "2026-09-28", "Asia/Kuala_Lumpur");
  assert.equal(monday.length, 1); // UPCOMING Course in PLANNED Term.
  await termLifecycle(prisma, owner, term.id, "CLOSED");
  assert.equal((await todaysClasses(prisma, owner, "2026-09-28", "Asia/Kuala_Lumpur")).length, 1);
  await putException(prisma, owner, schedule.id, moveData);
  assert.equal((await todaysClasses(prisma, owner, "2026-09-28", "Asia/Kuala_Lumpur")).length, 0);
  const moved = await todaysClasses(prisma, owner, "2026-09-30", "Asia/Kuala_Lumpur");
  assert.equal(moved.length, 1); assert.equal(moved[0]!.originalDate, "2026-09-28");
  assert.equal((await nextClass(prisma, owner, new Date("2026-09-29")))!.startsAt.toISOString(), "2026-09-30T07:00:00.000Z");
  await putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate: "2026-10-05" });
  assert.equal((await nextClass(prisma, owner, new Date("2026-10-01")))!.originalDate, "2026-10-12");
  const other = await createCourse(prisma, owner, { termId: term.id, courseCode: "B", title: "Overnight" });
  const overnight = await createSchedule(prisma, owner, { ...recurrence, courseId: other.id, localStartTime: "23:00", localEndTime: "01:00", endDayOffset: 1 });
  assert.equal((await todaysClasses(prisma, owner, "2026-09-29", "Asia/Kuala_Lumpur"))[0]!.scheduleId, overnight.id);
  const ny = await createSchedule(prisma, owner, { ...recurrence, courseId: other.id, timezone: "America/New_York" });
  const multiZone = await todaysClasses(prisma, owner, "2026-10-12", "Asia/Kuala_Lumpur");
  assert.deepEqual(multiZone.map((row) => row.scheduleId), [schedule.id, ny.id, overnight.id]);
  await archiveCourse(prisma, owner, course.id, true);
  assert.equal((await todaysClasses(prisma, owner, "2026-09-30", "Asia/Kuala_Lumpur")).length, 0);
  await courseLifecycle(prisma, owner, other.id, "COMPLETED");
  assert.equal(await nextClass(prisma, owner, now), null);
  await courseLifecycle(prisma, owner, other.id, "CANCELLED");
  assert.equal(await nextClass(prisma, owner, now), null);
  await courseLifecycle(prisma, owner, other.id, "ACTIVE");
  await archiveTerm(prisma, owner, term.id, true);
  assert.equal(await nextClass(prisma, owner, now, term.id), null);
});
test("split retains predecessor history, discards boundary/future exceptions, and enforces tail/date/course", async () => {
  const { owner, course, schedule } = await fixture();
  for (const date of ["2026-09-21", "2026-09-28", "2026-10-05"]) await putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate: date });
  await assert.rejects(splitSchedule(prisma, owner, schedule.id, "2026-09-21", { ...recurrence, courseId: course.id }, now), code("INVALID_STATE"));
  await assert.rejects(splitSchedule(prisma, owner, schedule.id, "2026-09-29", { ...recurrence, courseId: course.id }, now), code("INVALID_INPUT"));
  const successor = await splitSchedule(prisma, owner, schedule.id, "2026-09-28", { ...recurrence, weekday: 3, localStartTime: "11:00", localEndTime: "12:00", courseId: course.id }, now);
  const old = await ownedSchedule(prisma, owner, schedule.id);
  assert.equal(old.retiredFromDate!.toISOString().slice(0, 10), "2026-09-28");
  assert.equal(successor.predecessorId, old.id);
  assert.equal(successor.originalStartDate.toISOString().slice(0, 10), "2026-09-28");
  assert.deepEqual((await prisma.classScheduleException.findMany({ where: { scheduleId: old.id } })).map((row) => row.originalDate.toISOString().slice(0, 10)), ["2026-09-21"]);
  assert.equal(await prisma.classScheduleException.count({ where: { scheduleId: successor.id } }), 0);
  assert.ok(originalOccurrence(seriesFromRow(old), "2026-09-21"));
  assert.equal(originalOccurrence(seriesFromRow(old), "2026-09-28"), null);
  assert.equal((await nextClass(prisma, owner, now))!.scheduleId, successor.id);
  await assert.rejects(splitSchedule(prisma, owner, old.id, "2026-09-21", { ...recurrence, courseId: course.id }, new Date("2026-09-01")), code("CONFLICT"));
  await assert.rejects(putException(prisma, owner, old.id, { kind: "CANCEL", originalDate: "2026-09-28" }), code("INVALID_INPUT"));
  const foreignCourse = await createCourse(prisma, owner, { termId: course.termId, courseCode: "Other", title: "Other" });
  await assert.rejects(splitSchedule(prisma, owner, successor.id, "2026-09-30", { ...recurrence, courseId: foreignCourse.id }, now), code("INVALID_INPUT"));
  await retireSchedule(prisma, owner, successor.id, "2026-09-30", now);
  assert.equal(await nextClass(prisma, owner, now), null);
});
test("a database failure after retirement/deletion rolls back the complete split", async () => {
  const { owner, course, schedule } = await fixture();
  await putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate: "2026-09-28" });
  const failing = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction(async (tx) => {
      const intercepted = new Proxy(tx, { get(transaction, property) {
        if (property !== "$queryRaw") return Reflect.get(transaction, property);
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings[0]?.includes("INSERT INTO public.class_schedule")) await tx.$executeRaw`SELECT 1/0`;
          return tx.$queryRaw(strings, ...values);
        };
      } });
      return callback(intercepted);
    }, options);
  } }) as PrismaClient;
  await assert.rejects(splitSchedule(failing, owner, schedule.id, "2026-09-28", { ...recurrence, courseId: course.id }, now), code("INVALID_STATE"));
  assert.equal((await ownedSchedule(prisma, owner, schedule.id)).retiredFromDate, null);
  assert.equal(await prisma.classScheduleException.count({ where: { scheduleId: schedule.id } }), 1);
  assert.equal(await prisma.classSchedule.count({ where: { predecessorId: schedule.id } }), 0);
});
test("historical MOVE survives splitting and enters ranges after both source and successor have ended", async () => {
  const { owner, course, schedule } = await fixture();
  await putException(prisma, owner, schedule.id, { ...moveData, originalDate: "2026-09-21", replacementStartDate: "2027-04-06", replacementEndDate: "2027-04-06" });
  await splitSchedule(prisma, owner, schedule.id, "2026-09-28", { ...recurrence, courseId: course.id }, now);
  const moved = await todaysClasses(prisma, owner, "2027-04-06", "Asia/Kuala_Lumpur");
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.scheduleId, schedule.id);
  assert.equal(moved[0]!.originalDate, "2026-09-21");
  assert.equal(moved[0]!.startsAt.toISOString(), "2027-04-06T07:00:00.000Z");
  assert.equal((await nextClass(prisma, owner, new Date("2027-04-05")))!.scheduleId, schedule.id);
});

async function race(owner: { id: string }, operations: (() => Promise<unknown>)[]) {
  let entered!: () => void; let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const gate = withOwnerTransaction(prisma, owner.id, async () => { entered(); await held; });
  await ready;
  const pending = operations.map((operation) => operation());
  // Observe real lock waiters before releasing the gate, without timing sleeps.
  const observer = new Client({ connectionString: process.env.DATABASE_URL! });
  await observer.connect();
  try {
    const deadline = Date.now() + 3000;
    let waiting = 0;
    while (waiting < operations.length && Date.now() < deadline) {
      const result = await observer.query<{ count: string }>("SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%public.app_user%'");
      waiting = Number(result.rows[0]!.count);
    }
    assert.equal(waiting, operations.length, "all competing mutations reached the account gate");
  } finally { release(); await observer.end(); }
  await gate;
  return Promise.allSettled(pending);
}
test("deterministic concurrent exceptions and splits serialize and preserve one identity/linear chain", async () => {
  const { owner, course, schedule } = await fixture();
  const exceptions = await race(owner, [() => putException(prisma, owner, schedule.id, { kind: "CANCEL", originalDate: "2026-09-28" }), () => putException(prisma, owner, schedule.id, moveData)]);
  assert.ok(exceptions.every((result) => result.status === "fulfilled"));
  assert.equal(await prisma.classScheduleException.count({ where: { scheduleId: schedule.id } }), 1);
  const splits = await race(owner, [() => splitSchedule(prisma, owner, schedule.id, "2026-09-28", { ...recurrence, courseId: course.id }, now), () => splitSchedule(prisma, owner, schedule.id, "2026-09-28", { ...recurrence, courseId: course.id }, now)]);
  assert.equal(splits.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.classSchedule.count({ where: { predecessorId: schedule.id } }), 1);
  assert.equal(await prisma.classScheduleException.count({ where: { scheduleId: schedule.id } }), 0);
});
test("split/exception, archive/create, lifecycle/create and context-lock/reassignment races are safe", async () => {
  const a = await fixture();
  const splitRace = await race(a.owner, [() => splitSchedule(prisma, a.owner, a.schedule.id, "2026-09-28", { ...recurrence, courseId: a.course.id }, now), () => putException(prisma, a.owner, a.schedule.id, moveData)]);
  assert.equal(splitRace[0]!.status, "fulfilled");
  assert.equal(await prisma.classSchedule.count({ where: { predecessorId: a.schedule.id } }), 1);
  assert.equal(await prisma.classScheduleException.count({ where: { scheduleId: a.schedule.id } }), 0);
  const b = await fixture();
  const archiveRace = await race(b.owner, [() => archiveCourse(prisma, b.owner, b.course.id, true), () => createSchedule(prisma, b.owner, { ...recurrence, courseId: b.course.id })]);
  assert.equal(archiveRace[0]!.status, "fulfilled");
  assert.equal(await nextClass(prisma, b.owner, now), null);
  const c = await fixture();
  const lifecycleRace = await race(c.owner, [() => courseLifecycle(prisma, c.owner, c.course.id, "COMPLETED"), () => createSchedule(prisma, c.owner, { ...recurrence, courseId: c.course.id })]);
  assert.equal(lifecycleRace[0]!.status, "fulfilled");
  assert.equal(await nextClass(prisma, c.owner, now), null);
  const owner = await prisma.user.create({ data: {} });
  const one = await createTerm(prisma, owner, termData); const two = await createTerm(prisma, owner, termData);
  const course = await createCourse(prisma, owner, { termId: one.id, courseCode: "Race", title: "Race" });
  await race(owner, [() => createSchedule(prisma, owner, { ...recurrence, courseId: course.id }), () => updateCourse(prisma, owner, course.id, { termId: two.id, courseCode: "Race", title: "Race" })]);
  const locked = await ownedCourse(prisma, owner, course.id);
  assert.ok(locked.firstDependantAt);
  await assert.rejects(updateCourse(prisma, owner, course.id, { termId: locked.termId === one.id ? two.id : one.id, courseCode: "Race", title: "Race" }), code("INVALID_STATE"));
});
