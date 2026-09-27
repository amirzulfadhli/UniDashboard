"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrisma } from "../auth/db";
import { AcademicError } from "../academic/errors";
import { archiveCourse, archiveTerm, courseLifecycle, createCourse, createTerm, ownedCourse, selectTerm, termLifecycle, updateCourse, updateTerm } from "../academic/records";
import { createSchedule, putException, removeException, retireSchedule, splitSchedule } from "../academic/schedules";
import { requirePageUser } from "./protected-user";

function input(form: FormData): Record<string, unknown> { return Object.fromEntries(form.entries()); }
function timetableDestination(form: FormData) {
  const week = form.get("returnWeek");
  return typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? `/timetable?week=${week}` : "/timetable";
}
async function save(destination: string, write: (owner: Awaited<ReturnType<typeof requirePageUser>>) => Promise<unknown>) {
  const owner = await requirePageUser();
  let message: string | null = null;
  let target = destination;
  try {
    const result = await write(owner);
    if (destination === "/courses" && result && typeof result === "object") {
      if ("termId" in result && typeof result.termId === "string") target = `/courses?term=${encodeURIComponent(result.termId)}`;
      else if ("courseId" in result && typeof result.courseId === "string") {
        const course = await ownedCourse(getPrisma(), owner, result.courseId);
        target = `/courses?term=${encodeURIComponent(course.termId)}`;
      }
    }
  } catch (error) {
    message = error instanceof AcademicError ? error.message : "Unable to save the academic change. Please retry.";
  }
  for (const path of ["/home", "/terms", "/courses", "/timetable"]) revalidatePath(path);
  redirect(message ? `${target}${target.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}` : target);
}
export async function createTermAction(form: FormData) { await save("/terms", (owner) => createTerm(getPrisma(), owner, input(form))); }
export async function updateTermAction(form: FormData) { await save("/terms", (owner) => updateTerm(getPrisma(), owner, form.get("id"), input(form))); }
export async function selectTermAction(form: FormData) { await save("/terms", (owner) => selectTerm(getPrisma(), owner, form.get("id"))); }
export async function termLifecycleAction(form: FormData) { await save("/terms", (owner) => termLifecycle(getPrisma(), owner, form.get("id"), form.get("status"))); }
export async function archiveTermAction(form: FormData) { await save("/terms", (owner) => archiveTerm(getPrisma(), owner, form.get("id"), form.get("archived") === "true")); }
export async function createCourseAction(form: FormData) { await save("/courses", (owner) => createCourse(getPrisma(), owner, input(form))); }
export async function updateCourseAction(form: FormData) { await save("/courses", (owner) => updateCourse(getPrisma(), owner, form.get("id"), input(form))); }
export async function courseLifecycleAction(form: FormData) { await save("/courses", (owner) => courseLifecycle(getPrisma(), owner, form.get("id"), form.get("status"))); }
export async function archiveCourseAction(form: FormData) { await save("/courses", (owner) => archiveCourse(getPrisma(), owner, form.get("id"), form.get("archived") === "true")); }
export async function createScheduleAction(form: FormData) { await save("/courses", (owner) => createSchedule(getPrisma(), owner, input(form))); }
export async function exceptionAction(form: FormData) { await save(timetableDestination(form), (owner) => putException(getPrisma(), owner, form.get("scheduleId"), input(form))); }
export async function removeExceptionAction(form: FormData) { await save(timetableDestination(form), (owner) => removeException(getPrisma(), owner, form.get("scheduleId"), form.get("originalDate"))); }
export async function splitScheduleAction(form: FormData) { await save("/courses", (owner) => splitSchedule(getPrisma(), owner, form.get("scheduleId"), form.get("originalDate"), input(form))); }
export async function retireScheduleAction(form: FormData) { await save("/courses", (owner) => retireSchedule(getPrisma(), owner, form.get("scheduleId"), form.get("originalDate"))); }
