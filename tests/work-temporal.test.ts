import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";
import { Temporal } from "@js-temporal/polyfill";
import { createPrismaClient } from "../src/db/client";
import { createCourse, createTerm } from "../src/academic/records";
import { createSchedule } from "../src/academic/schedules";
import { academicDate } from "../src/academic/recurrence";
import { AcademicError } from "../src/academic/errors";
import { changeDeadline, createWork, getDeadline } from "../src/work/service";
import { queryWork } from "../src/work/queries";
const prisma = createPrismaClient();
after(async () => prisma.$disconnect());

test("deadline calendar categories survive process/database zones, local midnight and profile changes", async () => {
  const observer = new Client({ connectionString: process.env.DATABASE_URL! });
  await observer.connect();
  try { assert.equal((await observer.query("SHOW TIME ZONE")).rows[0].TimeZone, process.env.TEST_DATABASE_TIMEZONE); } finally { await observer.end(); }
  const owner = await prisma.user.create({ data: { profile: { create: { timezone: "Asia/Kuala_Lumpur" } } } });
  const term = await createTerm(prisma, owner, { name: "Dates", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01", academicTimezone: "Europe/London" });
  const course = await createCourse(prisma, owner, { termId: term.id, title: "Dates", courseCode: "DATE" });
  await createSchedule(prisma, owner, { courseId: course.id, weekday: 1, localStartTime: "09:00", localEndTime: "10:00", endDayOffset: 0, timezone: "Europe/London", originalStartDate: "2026-01-01", originalEndDate: "2026-12-31" });
  const now = new Date("2026-10-15T00:30:00Z");
  for (const zone of ["Asia/Kuala_Lumpur", "UTC", "America/New_York"]) {
    const today = Temporal.PlainDate.from(academicDate(now, zone));
    const ids: string[] = [];
    for (const offset of [-1, 0, 1]) {
      const row = await createWork(prisma, owner, "TASK", { title: `${zone} ${offset}`, courseId: course.id, deadlineKind: "DATE_ONLY", dueDate: today.add({ days: offset }).toString(), dueTimezone: zone });
      ids.push(row.id);
      const raw = await prisma.$queryRaw<{ date: string; instant: Date | null }[]>`SELECT due_date::text AS date,due_at AS instant FROM public.task WHERE id=${row.id}::uuid`;
      assert.equal(raw[0]!.date, today.add({ days: offset }).toString()); assert.equal(raw[0]!.instant, null);
    }
    const overdue = await queryWork(prisma, owner, { view: "OVERDUE", now });
    const dueToday = await queryWork(prisma, owner, { view: "TODAY", now });
    const upcoming = await queryWork(prisma, owner, { view: "UPCOMING", now, startDate: today.toString(), endDate: today.add({ days: 1 }).toString(), end: new Date(now.getTime() + 2 * 86400000) });
    assert.ok(overdue.some((row) => row.id === ids[0])); assert.ok(!overdue.some((row) => row.id === ids[1]));
    assert.ok(dueToday.some((row) => row.id === ids[1])); assert.ok(!dueToday.some((row) => row.id === ids[0] || row.id === ids[2]));
    assert.ok(upcoming.some((row) => row.id === ids[2])); assert.ok(!upcoming.some((row) => row.id === ids[1]));
    const nextMidnight = new Date(Temporal.ZonedDateTime.from({ timeZone: zone, year: today.year, month: today.month, day: today.day, hour: 0 }).add({ days: 1 }).epochMilliseconds);
    assert.ok(!(await queryWork(prisma, owner, { view: "OVERDUE", now: new Date(nextMidnight.getTime() - 1) })).some((row) => row.id === ids[1]));
    assert.ok((await queryWork(prisma, owner, { view: "OVERDUE", now: nextMidnight })).some((row) => row.id === ids[1]));
    const before = await getDeadline(prisma, owner, "TASK", ids[1]);
    await prisma.profile.update({ where: { ownerId: owner.id }, data: { timezone: "America/New_York" } });
    assert.deepEqual(await getDeadline(prisma, owner, "TASK", ids[1]), before);
    assert.ok((await queryWork(prisma, owner, { view: "TODAY", now })).some((row) => row.id === ids[1]));
    assert.ok((await queryWork(prisma, owner, { view: "DUE_ON", date: today.toString(), now })).some((row) => row.id === ids[1]));
  }
});
test("timed instants retain milliseconds, inclusive start/exclusive end, local day and DST policy", async () => {
  const owner = await prisma.user.create({ data: {} });
  const now = new Date("2026-10-15T12:00:00.123Z");
  const rows = [];
  for (const delta of [-1, 0, 1, 1000]) rows.push(await createWork(prisma, owner, "TASK", { title: `Instant ${delta}`, deadlineKind: "TIMED", dueAt: new Date(now.getTime() + delta).toISOString(), dueTimezone: "America/New_York" }));
  const upcoming = await queryWork(prisma, owner, { view: "UPCOMING", now, startDate: "2026-10-15", endDate: "2026-10-16", start: now, end: new Date(now.getTime() + 1000) });
  assert.deepEqual(upcoming.map((row) => row.id), [rows[1]!.id, rows[2]!.id]);
  assert.deepEqual((await queryWork(prisma, owner, { view: "OVERDUE", now })).map((row) => row.id), [rows[0]!.id]);
  assert.equal((await queryWork(prisma, owner, { view: "TODAY", now })).length, 4);
  assert.equal((await queryWork(prisma, owner, { view: "DUE_ON", date: "2026-10-15", now })).length, 4);
  await assert.rejects(createWork(prisma, owner, "TASK", { title: "DST gap", deadlineKind: "TIMED", dueLocalDate: "2026-03-08", dueLocalTime: "02:30", dueTimezone: "America/New_York" }), (error: unknown) => error instanceof AcademicError && error.code === "INVALID_INPUT");
  const overlap = await createWork(prisma, owner, "TASK", { title: "DST overlap", deadlineKind: "TIMED", dueLocalDate: "2026-11-01", dueLocalTime: "01:30", dueTimezone: "America/New_York" });
  assert.equal(overlap.dueAt!.toISOString(), "2026-11-01T05:30:00.000Z");
  const date = await createWork(prisma, owner, "TASK", { title: "Zone edit", deadlineKind: "DATE_ONLY", dueDate: "2026-10-15", dueTimezone: "UTC" });
  const midnight = new Date("2026-10-15T00:30Z");
  assert.ok((await queryWork(prisma, owner, { view: "TODAY", now: midnight })).some((row) => row.id === date.id));
  await changeDeadline(prisma, owner, "TASK", date.id, "UPDATE", { deadlineKind: "DATE_ONLY", dueDate: "2026-10-15", dueTimezone: "America/New_York" });
  assert.ok(!(await queryWork(prisma, owner, { view: "TODAY", now: midnight })).some((row) => row.id === date.id));
  assert.equal((await getDeadline(prisma, owner, "TASK", date.id)).dueDate, "2026-10-15");
});
