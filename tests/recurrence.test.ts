import assert from "node:assert/strict";
import { test } from "node:test";
import { localDayRange, nextOccurrence, occurrencesInRange, originalOccurrence, type OccurrenceException, type Series } from "../src/academic/recurrence";

const base: Series = { id: "series", courseId: "course", weekday: 1, localStartTime: "09:00:00", localEndTime: "10:00:00", endDayOffset: 0,
  timezone: "Asia/Kuala_Lumpur", originalStartDate: "2026-09-01", originalEndDate: "2026-12-31", retiredFromDate: null, location: "Room A" };
const cancel = (originalDate: string): OccurrenceException => ({ originalDate, kind: "CANCEL", replacementStartsAt: null, replacementEndsAt: null, replacementTimezone: null, replacementLocation: null });
const move: OccurrenceException = { originalDate: "2026-09-28", kind: "MOVE", replacementStartsAt: new Date("2026-09-30T07:00:00Z"), replacementEndsAt: new Date("2026-09-30T08:00:00Z"), replacementTimezone: "Asia/Kuala_Lumpur", replacementLocation: "Room B" };

test("weekly dates, weekday, inclusive series boundaries, and half-open effective range", () => {
  const rows = occurrencesInRange(base, [], new Date("2026-09-01T00:00Z"), new Date("2026-09-29T00:00Z"));
  assert.deepEqual(rows.map((row) => row.originalDate), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(rows[0]!.startsAt.toISOString(), "2026-09-07T01:00:00.000Z");
  assert.equal(originalOccurrence(base, "2026-09-08"), null);
  assert.equal(originalOccurrence(base, "2026-08-31"), null);
  assert.equal(originalOccurrence(base, "2027-01-04"), null);
  assert.equal(occurrencesInRange(base, [], new Date("2026-09-07T02:00Z"), new Date("2026-09-07T03:00Z")).length, 0);
  assert.equal(occurrencesInRange(base, [], new Date("2026-09-07T00:00Z"), new Date("2026-09-07T01:00Z")).length, 0);
});
test("overnight classes overlap both civil days and retirement excludes the boundary", () => {
  const overnight = { ...base, localStartTime: "23:00:00", localEndTime: "01:00:00", endDayOffset: 1 };
  const interval = localDayRange("2026-09-29", base.timezone);
  const rows = occurrencesInRange(overnight, [], interval.start, interval.end);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.originalDate, "2026-09-28");
  assert.equal(rows[0]!.endsAt.toISOString(), "2026-09-28T17:00:00.000Z");
  assert.ok(originalOccurrence({ ...base, retiredFromDate: "2026-09-28" }, "2026-09-21"));
  assert.equal(originalOccurrence({ ...base, retiredFromDate: "2026-09-28" }, "2026-09-28"), null);
});
test("CANCEL is excluded from active queries and MOVE uses effective placement with original identity", () => {
  const monday = localDayRange("2026-09-28", base.timezone);
  assert.equal(occurrencesInRange(base, [cancel("2026-09-28")], monday.start, monday.end).length, 0);
  assert.equal(occurrencesInRange(base, [cancel("2026-09-28")], monday.start, monday.end, true)[0]!.state, "CANCELLED");
  assert.equal(occurrencesInRange(base, [move], monday.start, monday.end).length, 0);
  const wednesday = localDayRange("2026-09-30", base.timezone);
  const moved = occurrencesInRange(base, [move], wednesday.start, wednesday.end);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.scheduleId, base.id);
  assert.equal(moved[0]!.originalDate, "2026-09-28");
  assert.equal(moved[0]!.state, "MOVED");
  assert.equal(moved[0]!.location, "Room B");
  assert.equal(nextOccurrence(base, [move, cancel("2026-10-05")], new Date("2026-09-29T00:00Z"))!.originalDate, "2026-09-28");
  assert.equal(nextOccurrence(base, [cancel("2026-09-28")], new Date("2026-09-27T00:00Z"))!.originalDate, "2026-10-05");
});
test("New York and London preserve 09:00 local across DST using independently specified UTC instants", () => {
  const ny = { ...base, timezone: "America/New_York", weekday: 7, originalStartDate: "2026-03-01", originalEndDate: "2026-11-30" };
  assert.equal(originalOccurrence(ny, "2026-03-01")!.startsAt.toISOString(), "2026-03-01T14:00:00.000Z");
  assert.equal(originalOccurrence(ny, "2026-03-08")!.startsAt.toISOString(), "2026-03-08T13:00:00.000Z");
  assert.equal(originalOccurrence(ny, "2026-10-25")!.startsAt.toISOString(), "2026-10-25T13:00:00.000Z");
  assert.equal(originalOccurrence(ny, "2026-11-01")!.startsAt.toISOString(), "2026-11-01T14:00:00.000Z");
  assert.deepEqual(occurrencesInRange(ny, [], new Date("2026-03-01T00:00Z"), new Date("2026-03-16T00:00Z")).map((row) => row.startsAt.toISOString()),
    ["2026-03-01T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-03-15T13:00:00.000Z"]);
  const london = { ...ny, timezone: "Europe/London" };
  assert.equal(originalOccurrence(london, "2026-03-22")!.startsAt.toISOString(), "2026-03-22T09:00:00.000Z");
  assert.equal(originalOccurrence(london, "2026-03-29")!.startsAt.toISOString(), "2026-03-29T08:00:00.000Z");
  assert.equal(originalOccurrence(london, "2026-10-18")!.startsAt.toISOString(), "2026-10-18T08:00:00.000Z");
  assert.equal(originalOccurrence(london, "2026-10-25")!.startsAt.toISOString(), "2026-10-25T09:00:00.000Z");
  assert.deepEqual(occurrencesInRange(london, [], new Date("2026-03-22T00:00Z"), new Date("2026-04-06T00:00Z")).map((row) => row.startsAt.toISOString()),
    ["2026-03-22T09:00:00.000Z", "2026-03-29T08:00:00.000Z", "2026-04-05T08:00:00.000Z"]);
  assert.equal(originalOccurrence(base, "2026-10-26")!.startsAt.toISOString(), "2026-10-26T01:00:00.000Z");
});
test("DST gaps are nonexistent identities; repeated times select the earlier instant", () => {
  const ny = { ...base, timezone: "America/New_York", weekday: 7, originalStartDate: "2026-01-01", originalEndDate: "2026-12-31", localStartTime: "02:30:00", localEndTime: "03:30:00" };
  assert.equal(originalOccurrence(ny, "2026-03-08"), null);
  assert.equal(originalOccurrence({ ...ny, localStartTime: "01:30:00", localEndTime: "02:30:00" }, "2026-11-01")!.startsAt.toISOString(), "2026-11-01T05:30:00.000Z");
  const range = localDayRange("2026-03-08", "America/New_York");
  assert.equal(range.end.getTime() - range.start.getTime(), 23 * 3600000);
  const autumn = localDayRange("2026-11-01", "America/New_York");
  assert.equal(autumn.end.getTime() - autumn.start.getTime(), 25 * 3600000);
});
test("next seeking stops at the final supported calendar year instead of wrapping string dates", () => {
  const end = { ...base, originalStartDate: "9999-12-01", originalEndDate: "9999-12-31" };
  assert.equal(nextOccurrence(end, [], new Date("9999-12-31T00:00Z")), null);
});
