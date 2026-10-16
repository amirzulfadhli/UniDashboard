import assert from "node:assert/strict";
import { test } from "node:test";
import { classPosition, compareAgendaItems, happeningNow, nextTimedItem, pointPosition, tomorrowDate, viewerStamp, viewerToday, viewerWindow, weekDates } from "../src/agenda/temporal";
import { deadlineFacts } from "../src/work/queries";
import type { AgendaResult, ClassAgendaItem, DateOnlyAgendaItem, TimedAgendaItem } from "../src/agenda/types";

const instant = (value: string) => new Date(value);
const course = { id: "course", code: "CS101", title: "Algorithms" };
const classItem = (id: string, start: string, end: string): ClassAgendaItem => ({ kind: "CLASS", identity: { scheduleId: id, originalDate: "2026-03-08" }, title: "Algorithms", course,
  occurrenceState: "NORMAL", startsAt: instant(start), endsAt: instant(end), effectiveTimezone: "America/New_York", viewerStartDate: "2026-03-08", viewerStartTime: "23:30",
  viewerEndDate: "2026-03-09", viewerEndTime: "01:00", location: null, position: "CURRENT" });
const timedItem = (id: string, at: string): TimedAgendaItem => ({ kind: "TASK_DEADLINE", identity: { workId: id }, title: id, lifecycle: "TODO",
  deadline: { kind: "TIMED", at: instant(at), timezone: "UTC", sourceDate: "2026-03-09", dueToday: true, overdue: false }, viewerDate: "2026-03-09", viewerTime: "00:30", position: "UPCOMING" });
const dateItem: DateOnlyAgendaItem = { kind: "PROJECT_DEADLINE", identity: { workId: "all-day" }, title: "Project", lifecycle: "ACTIVE",
  deadline: { kind: "DATE_ONLY", date: "2026-03-09", timezone: "Asia/Kuala_Lumpur", classification: "DUE_TODAY" }, viewerDate: "2026-03-09" };

test("Profile-local today, tomorrow and Monday–Sunday week survive DST", () => {
  const nearMidnight = instant("2026-09-27T16:30:00Z");
  assert.equal(viewerToday(nearMidnight, "Asia/Kuala_Lumpur"), "2026-09-28");
  assert.equal(tomorrowDate(nearMidnight, "Asia/Kuala_Lumpur"), "2026-09-29");
  assert.deepEqual(weekDates(nearMidnight, "Asia/Kuala_Lumpur"), { startDate: "2026-09-28", endDate: "2026-10-04" });
  const spring = instant("2026-03-08T06:30:00Z");
  assert.equal(viewerToday(spring, "America/New_York"), "2026-03-08");
  assert.equal(tomorrowDate(spring, "America/New_York"), "2026-03-09");
  assert.deepEqual(weekDates(spring, "America/New_York"), { startDate: "2026-03-02", endDate: "2026-03-08" });
  assert.equal(viewerWindow("2026-03-08", "2026-03-08", "America/New_York").end.getTime() - viewerWindow("2026-03-08", "2026-03-08", "America/New_York").start.getTime(), 23 * 3600000);
  assert.equal(viewerWindow("2026-11-01", "2026-11-01", "America/New_York").end.getTime() - viewerWindow("2026-11-01", "2026-11-01", "America/New_York").start.getTime(), 25 * 3600000);
});
test("timed instants use viewer zone while date-only facts retain source calendar meaning", () => {
  const at = instant("2026-10-15T16:00:00Z");
  assert.deepEqual(viewerStamp(at, "Asia/Kuala_Lumpur"), { date: "2026-10-16", time: "00:00" });
  assert.deepEqual(viewerStamp(at, "America/New_York"), { date: "2026-10-15", time: "12:00" });
  const row = { deadlineKind: "DATE_ONLY" as const, dueDate: instant("2026-10-16T00:00:00Z"), dueAt: null, dueTimezone: "Asia/Kuala_Lumpur" };
  assert.deepEqual(deadlineFacts(row, instant("2026-10-15T15:59:59Z")), { sourceToday: "2026-10-15", sourceDueDate: "2026-10-16", dueToday: false, overdue: false, upcoming: true });
  assert.deepEqual(deadlineFacts(row, instant("2026-10-15T16:00:00Z")), { sourceToday: "2026-10-16", sourceDueDate: "2026-10-16", dueToday: true, overdue: false, upcoming: false });
  assert.equal(deadlineFacts(row, instant("2026-10-16T16:00:00Z"))?.overdue, true);
  assert.equal(deadlineFacts({ deadlineKind: "TIMED", dueDate: null, dueAt: at, dueTimezone: "UTC" }, at)?.overdue, false);
});
test("overnight carry-over precedes timed items; date-only remains untimed and ties are stable", () => {
  const carry = classItem("schedule-b", "2026-03-09T03:30:00Z", "2026-03-09T05:00:00Z");
  const newer = classItem("schedule-a", "2026-03-09T04:30:00Z", "2026-03-09T06:00:00Z");
  const timed = timedItem("task-a", "2026-03-09T04:30:00Z");
  const start = instant("2026-03-09T04:00:00Z");
  const sorted = [dateItem, timed, newer, carry].sort((a, b) => compareAgendaItems(a, b, start));
  assert.deepEqual(sorted.map((item) => item.kind === "CLASS" ? item.identity.scheduleId : item.identity.workId), ["schedule-b", "schedule-a", "task-a", "all-day"]);
  assert.equal(classPosition(carry.startsAt, carry.endsAt, instant("2026-03-09T04:00:00Z")), "CURRENT");
  assert.equal(classPosition(carry.startsAt, carry.endsAt, instant("2026-03-09T05:00:00Z")), "PAST");
  assert.equal(classPosition(newer.startsAt, newer.endsAt, instant("2026-03-09T04:00:00Z")), "UPCOMING");
  assert.equal(pointPosition(timed.deadline.at, instant("2026-03-09T04:30:00Z")), "UPCOMING");
});
test("current classes deduplicate across days and next ignores date-only deadlines", () => {
  const carry = classItem("schedule-b", "2026-03-09T03:30:00Z", "2026-03-09T05:00:00Z");
  const future = timedItem("task-a", "2026-03-09T04:30:00Z");
  const agenda: AgendaResult = { viewerTimezone: "America/New_York", startDate: "2026-03-08", endDate: "2026-03-09", expandedClassOccurrences: 1, returnedItems: 4,
    days: [{ date: "2026-03-08", startAt: instant("2026-03-08T05:00:00Z"), endAt: instant("2026-03-09T04:00:00Z"), items: [carry] },
      { date: "2026-03-09", startAt: instant("2026-03-09T04:00:00Z"), endAt: instant("2026-03-10T04:00:00Z"), items: [carry, dateItem, future] }] };
  const now = instant("2026-03-09T04:15:00Z");
  assert.deepEqual(happeningNow(agenda, now).map((item) => item.identity.scheduleId), ["schedule-b"]);
  const next = nextTimedItem(agenda, now);
  assert.ok(next && next.kind !== "CLASS");
  assert.equal(next.identity.workId, "task-a");
});
test("malformed or excessive viewer ranges fail before recurrence expansion", () => {
  for (const [start, end] of [["bad", "2026-01-02"], ["2026-02-30", "2026-03-01"], ["2026-01-03", "2026-01-02"], ["2026-01-01", "2027-01-02"]])
    assert.throws(() => viewerWindow(start, end, "UTC"));
  assert.throws(() => viewerToday(new Date(Number.NaN), "UTC"));
});
test("366 viewer-local calendar dates remain valid across DST changes", () => {
  const fall = viewerWindow("2025-11-01", "2026-11-01", "America/New_York");
  assert.equal(fall.days.length, 366);
  assert.equal(fall.end.getTime() - fall.start.getTime(), 366 * 86400000 + 3600000);
  assert.throws(() => viewerWindow("2025-11-01", "2026-11-02", "America/New_York"));

  const spring = viewerWindow("2025-03-09", "2026-03-09", "America/New_York");
  assert.equal(spring.days.length, 366);
  assert.equal(spring.end.getTime() - spring.start.getTime(), 366 * 86400000 - 3600000);

  const noDst = viewerWindow("2025-11-01", "2026-11-01", "Asia/Kuala_Lumpur");
  assert.equal(noDst.days.length, 366);
  assert.equal(noDst.end.getTime() - noDst.start.getTime(), 366 * 86400000);
  assert.equal(viewerWindow("2025-11-01", "2025-11-01", "America/New_York").days.length, 1);
});
