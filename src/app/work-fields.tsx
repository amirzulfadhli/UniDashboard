"use client";
import { useState } from "react";
import type { WorkKind } from "../work/validation";

export type Choice = { id: string; label: string; eligible: boolean };
export type Choices = { terms: Choice[]; courses: Choice[]; projects: Choice[]; assignments: Choice[] };
export function DeadlineFields({ timezone, allowNone, data = {} }: { timezone: string; allowNone: boolean; data?: Partial<Record<"deadlineKind" | "dueDate" | "dueAt" | "dueTimezone", string | undefined>> }) {
  const [kind, setKind] = useState(!allowNone && (!data.deadlineKind || data.deadlineKind === "NONE") ? "DATE_ONLY" : data.deadlineKind ?? "NONE");
  return <><label>Deadline type<select name="deadlineKind" value={kind} onChange={(event) => setKind(event.target.value)}>{allowNone && <option>NONE</option>}<option>DATE_ONLY</option><option>TIMED</option></select></label>
    {kind !== "NONE" && <label>Deadline timezone (IANA)<input name="dueTimezone" defaultValue={data.dueTimezone ?? timezone} required /></label>}
    {kind === "DATE_ONLY" && <label>Due date<input name="dueDate" type="date" defaultValue={data.dueDate} required /></label>}
    {kind === "TIMED" && (data.dueAt ? <label>Due instant (ISO with offset)<input name="dueAt" defaultValue={data.dueAt} required /></label> : <><label>Local due date<input name="dueLocalDate" type="date" required /></label><label>Local due time<input name="dueLocalTime" type="time" step="1" required /></label></>)}
  </>;
}
export function WorkFields({ kind, choices, data = {} }: { kind: WorkKind; choices: Choices; data?: Partial<Record<"title" | "description" | "priority" | "termId" | "courseId" | "homeTermId" | "assignmentId" | "projectId", string>> }) {
  const [scope, setScope] = useState(kind === "ASSIGNMENT" ? "courseId" : data.courseId ? "courseId" : data.assignmentId ? "assignmentId" : data.termId ? "termId" : data.homeTermId ? "homeTermId" : "none");
  const select = (name: keyof Choices, field: string, label: string, required = false) => <label>{label}<select name={field} defaultValue={data[field as keyof typeof data] ?? ""} required={required}><option value="">{required ? "Choose…" : "None"}</option>{choices[name].map((choice) => <option key={choice.id} value={choice.id} disabled={!choice.eligible && choice.id !== data[field as keyof typeof data]}>{choice.label}{!choice.eligible ? " (historical)" : ""}</option>)}</select></label>;
  return <><label>Title<input name="title" defaultValue={data.title} required maxLength={200} /></label><label>Description (optional)<input name="description" defaultValue={data.description} maxLength={2000} /></label><label>Priority<select name="priority" defaultValue={data.priority ?? "MEDIUM"}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((value) => <option key={value}>{value}</option>)}</select></label>
    {kind !== "ASSIGNMENT" && <label>Academic context<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="none">Standalone</option><option value="courseId">Course</option>{kind === "TASK" ? <><option value="termId">Term</option><option value="assignmentId">Assignment</option></> : <option value="homeTermId">Home term</option>}</select></label>}
    {scope === "courseId" && select("courses", "courseId", "Course", true)}{scope === "assignmentId" && select("assignments", "assignmentId", "Assignment", true)}{scope === "termId" && select("terms", "termId", "Term", true)}{scope === "homeTermId" && select("terms", "homeTermId", "Home term", true)}
    {kind === "TASK" && scope !== "courseId" && select("projects", "projectId", "Project (optional)")}
    {kind === "TASK" && scope === "courseId" && <p>To organize academic work in a Project, create an Assignment and attach the Task to that Assignment and Project.</p>}
  </>;
}
