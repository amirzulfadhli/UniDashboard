import "server-only";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "./home/sign-out-button";

export function AcademicShell({ title, error, children }: { title: string; error?: string | undefined; children: ReactNode }) {
  return <main className="min-h-screen"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-5">
    <Link href="/home" className="font-semibold text-indigo-700">UniOS</Link><nav className="flex gap-4" aria-label="Academic navigation"><Link href="/terms">Terms</Link><Link href="/courses">Courses</Link><Link href="/timetable">Timetable</Link></nav><SignOutButton />
  </div></header><div className="academic mx-auto max-w-5xl px-4 py-8"><h1 className="mb-6 text-3xl font-semibold">{title}</h1>
    {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}{children}</div></main>;
}
export function Field({ name, label, value = "", type = "text", required = true }: { name: string; label: string; value?: string | undefined; type?: string; required?: boolean }) {
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} step={type === "time" ? "1" : undefined} /></label>;
}
export function Hidden({ name, value }: { name: string; value: string }) { return <input type="hidden" name={name} value={value} />; }
export function Submit({ children }: { children: ReactNode }) { return <button type="submit">{children}</button>; }
export function TermFields({ data = {} }: { data?: Partial<Record<"name" | "startsOn" | "endsOn" | "teachingStartsOn" | "academicTimezone", string>> }) {
  return <><Field name="name" label="Term name" value={data.name} /><Field name="startsOn" label="Start date" type="date" value={data.startsOn} />
    <Field name="endsOn" label="End date" type="date" value={data.endsOn} /><Field name="teachingStartsOn" label="Teaching starts" type="date" value={data.teachingStartsOn} />
    <Field name="academicTimezone" label="Academic timezone (IANA)" value={data.academicTimezone ?? "Asia/Kuala_Lumpur"} /></>;
}
export function ScheduleFields({ data = {}, split = false }: { split?: boolean; data?: Partial<Record<"weekday" | "localStartTime" | "localEndTime" | "endDayOffset" | "timezone" | "originalStartDate" | "originalEndDate" | "location", string>> }) {
  return <><label>Weekday<select name="weekday" defaultValue={data.weekday ?? "1"}>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
    <Field name="localStartTime" label="Local start time" type="time" value={data.localStartTime ?? "09:00"} /><Field name="localEndTime" label="Local end time" type="time" value={data.localEndTime ?? "10:00"} />
    <label>End day<select name="endDayOffset" defaultValue={data.endDayOffset ?? "0"}><option value="0">Same day</option><option value="1">Next day (overnight)</option></select></label>
    <Field name="timezone" label="Schedule timezone (IANA)" value={data.timezone ?? "Asia/Kuala_Lumpur"} />{!split && <Field name="originalStartDate" label="Series start date" type="date" value={data.originalStartDate} />}
    <Field name="originalEndDate" label="Series end date" type="date" value={data.originalEndDate} /><Field name="location" label="Location (optional)" value={data.location ?? ""} required={false} /></>;
}
