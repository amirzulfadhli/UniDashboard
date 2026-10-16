export type CourseSummary = { id: string; code: string; title: string };
export type ProjectSummary = { id: string; title: string };
export type AssignmentSummary = { id: string; title: string };
export type TemporalPosition = "PAST" | "CURRENT" | "UPCOMING";

export type ClassAgendaItem = {
  kind: "CLASS";
  identity: { scheduleId: string; originalDate: string };
  title: string;
  course: CourseSummary;
  occurrenceState: "NORMAL" | "MOVED";
  startsAt: Date;
  endsAt: Date;
  effectiveTimezone: string;
  viewerStartDate: string;
  viewerStartTime: string;
  viewerEndDate: string;
  viewerEndTime: string;
  location: string | null;
  position: TemporalPosition;
};

type WorkBase = {
  kind: "TASK_DEADLINE" | "ASSIGNMENT_DEADLINE" | "PROJECT_DEADLINE";
  identity: { workId: string };
  title: string;
  lifecycle: string;
  course?: CourseSummary;
  project?: ProjectSummary;
  assignment?: AssignmentSummary;
};
export type DateOnlyAgendaItem = WorkBase & {
  deadline: { kind: "DATE_ONLY"; date: string; timezone: string; classification: "OVERDUE" | "DUE_TODAY" | "UPCOMING" };
  viewerDate: string;
};
export type TimedAgendaItem = WorkBase & {
  deadline: { kind: "TIMED"; at: Date; timezone: string; sourceDate: string; dueToday: boolean; overdue: boolean };
  viewerDate: string;
  viewerTime: string;
  position: "PAST" | "UPCOMING";
};
export type WorkAgendaItem = DateOnlyAgendaItem | TimedAgendaItem;
export type AgendaItem = ClassAgendaItem | WorkAgendaItem;
export type AgendaDay = { date: string; startAt: Date; endAt: Date; items: AgendaItem[] };
export type AgendaResult = {
  viewerTimezone: string;
  startDate: string;
  endDate: string;
  days: AgendaDay[];
  expandedClassOccurrences: number;
  returnedItems: number;
};
