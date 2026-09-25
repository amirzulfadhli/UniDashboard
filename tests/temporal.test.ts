import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { createPrismaClient } from "../src/db/client.js";

const url = process.env.DATABASE_URL;
const expectedDatabaseZone = process.env.TEST_DATABASE_TIMEZONE;
if (!url || !expectedDatabaseZone) throw new Error("Temporal tests require DATABASE_URL and TEST_DATABASE_TIMEZONE");

const instant = new Date("2026-09-25T00:30:00.123Z");

test("Prisma DATE, TIME and TIMESTAMPTZ preserve independent PostgreSQL values", async () => {
  const pg = new Client({ connectionString: url });
  const prisma = createPrismaClient(url);
  await pg.connect();
  try {
    const rawZone = await pg.query("SELECT current_setting('TimeZone') AS zone");
    assert.equal(rawZone.rows[0].zone, expectedDatabaseZone);

    // Concurrent transactions hold separate physical pool members. Every one
    // must receive UTC at connection startup, even as the pool expands.
    const poolSessions = await Promise.all(Array.from({ length: 4 }, () =>
      prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ zone: string; pid: number }[]>`
          SELECT current_setting('TimeZone') AS zone, pg_backend_pid() AS pid
        `;
        await new Promise((done) => setTimeout(done, 75));
        return rows[0]!;
      }),
    ));
    assert.equal(new Set(poolSessions.map((session) => session.pid)).size, 4);
    for (const session of poolSessions) assert.equal(session.zone, "UTC");
    const conflictingUrl=new URL(url);
    conflictingUrl.searchParams.set("options","-c TimeZone=America/Los_Angeles");
    const forced=createPrismaClient(conflictingUrl.toString());
    try{
      const forcedZone=await forced.$queryRaw<{zone:string}[]>`SELECT current_setting('TimeZone') AS zone`;
      assert.equal(forcedZone[0]?.zone,"UTC");
    }finally{
      await forced.$disconnect();
    }

    const owner = await prisma.user.create({ data: {
      profile: { create: { timezone: "Asia/Kuala_Lumpur" } },
    } });
    const term = await prisma.term.create({ data: {
      owner: { connect: { id: owner.id } },
      name: "Temporal term",
      startsOn: new Date("2026-09-25T00:00:00.000Z"),
      endsOn: new Date("2026-12-31T00:00:00.000Z"),
      teachingStartsOn: new Date("2026-09-25T00:00:00.000Z"),
      academicTimezone: "Asia/Kuala_Lumpur",
    } });
    const course = await prisma.course.create({ data: {
      owner: { connect: { id: owner.id } },
      term: { connect: { id: term.id } },
      courseCode: "TIME101",
      title: "Temporal course",
    } });
    const schedule = await prisma.classSchedule.create({ data: {
      owner: { connect: { id: owner.id } },
      course: { connect: { id: course.id } },
      weekday: 5,
      localStartTime: new Date("1970-01-01T09:15:00.000Z"),
      localEndTime: new Date("1970-01-01T10:45:00.000Z"),
      timezone: "Asia/Kuala_Lumpur",
      originalStartDate: new Date("2026-09-25T00:00:00.000Z"),
      originalEndDate: new Date("2026-12-25T00:00:00.000Z"),
    } });
    const written = await prisma.task.create({ data: {
      owner: { connect: { id: owner.id } },
      title: "Prisma instant",
      deadlineKind: "TIMED",
      dueAt: instant,
      dueTimezone: "UTC",
    } });

    // This SQL connection does not use Prisma's adapter. Epoch is independent
    // of the session's display timezone and proves the stored absolute instant.
    const actual = await pg.query(`
      SELECT extract(epoch FROM task.due_at) * 1000 AS epoch_ms,
             term.starts_on::text AS literal_date,
             class_schedule.local_start_time::text AS local_time
      FROM task, term, class_schedule
      WHERE task.id=$1 AND term.id=$2 AND class_schedule.id=$3
    `, [written.id, term.id, schedule.id]);
    assert.equal(Number(actual.rows[0].epoch_ms), instant.getTime());
    assert.equal(actual.rows[0].literal_date, "2026-09-25");
    assert.equal(actual.rows[0].local_time, "09:15:00");
    console.log(`database=${expectedDatabaseZone} process=${process.env.TZ} stored_epoch_ms=${Number(actual.rows[0].epoch_ms)}`);

    const sqlWritten = await pg.query(`
      INSERT INTO task (owner_id,title,deadline_kind,due_at,due_timezone)
      VALUES ($1,'SQL instant','TIMED',$2::timestamptz,'UTC') RETURNING id
    `, [owner.id, instant.toISOString()]);
    const read = await prisma.task.findUniqueOrThrow({ where: { id: sqlWritten.rows[0].id } });
    assert.equal(read.dueAt?.getTime(), instant.getTime());

    const termRead = await prisma.term.findUniqueOrThrow({ where: { id: term.id } });
    const scheduleRead = await prisma.classSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    assert.equal(termRead.startsOn.toISOString(), "2026-09-25T00:00:00.000Z");
    assert.equal(scheduleRead.localStartTime.toISOString(), "1970-01-01T09:15:00.000Z");
  } finally {
    await prisma.$disconnect();
    await pg.end();
  }
});
