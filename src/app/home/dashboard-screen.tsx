import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import type { ReactNode } from "react";
import type { ClassAgendaItem } from "../../agenda/types";
import { agendaIdentity, viewerStamp } from "../../agenda/temporal";
import type { Dashboard, DashboardWork } from "../../dashboard/queries";
import { SignOutButton } from "./sign-out-button";

const paths = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2 M8 14h2 M14 14h2 M8 18h2",
  check: "M9 11l3 3L22 4 M21 12v8H3V3h13",
  book: "M12 5v16 M12 5C9 2 5 3 2 3v16c4 0 7 0 10 2 3-2 6-2 10-2V3c-3 0-7-1-10 2",
  folder: "M3 6h7l2 3h9v11H3z M3 6V4h7l2 2h9v3",
  note: "M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  pin: "M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 12 0 M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  plus: "M12 5v14 M5 12h14",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
} as const;
function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function DateLabel({ date, full = false }: { date: string; full?: boolean }) {
  return <time dateTime={date}>{Temporal.PlainDate.from(date).toLocaleString("en-GB", full
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short" })}</time>;
}
const workLink = (item: DashboardWork) => `/work#work-${item.id}`;
function DeadlineLabel({ item, zone }: { item: DashboardWork; zone: string }) {
  const deadline = item.deadline;
  if (!deadline) return <span>No deadline</span>;
  return <span><DateLabel date={deadline.date} />{deadline.kind === "DATE_ONLY" ? " · All day" : ` · ${deadline.time}`}
    <span className="dash-source">{deadline.kind === "DATE_ONLY" ? deadline.timezone : zone}
      {deadline.kind === "TIMED" && deadline.timezone !== zone && <> · Source: {deadline.sourceDate}, {deadline.timezone}</>}
    </span></span>;
}
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  return <span className={`dash-badge dash-badge-${tone}`}>{children}</span>;
}
function Empty({ icon, title, children, href, action }: { icon: keyof typeof paths; title: string; children: ReactNode; href: string; action: string }) {
  return <div className="dash-empty"><span className="dash-empty-icon"><Icon name={icon} size={24} /></span><h3>{title}</h3><p>{children}</p><Link href={href}>{action} <Icon name="arrow" size={16} /></Link></div>;
}
function ClassTime({ item, today }: { item: ClassAgendaItem; today: string }) {
  return <>{item.viewerStartDate !== today && <><DateLabel date={item.viewerStartDate} /> · </>}{item.viewerStartTime}–{item.viewerEndTime}
    {item.viewerEndDate !== item.viewerStartDate && <> · ends <DateLabel date={item.viewerEndDate} /></>}</>;
}

export function DashboardScreen({ dashboard: d }: { dashboard: Dashboard }) {
  const hour = Number(viewerStamp(d.now, d.timezone).time.slice(0, 2));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = d.displayName?.trim().split(/\s+/)[0];
  const focus = d.currentClasses[0] ?? d.nextClass;
  const remaining = d.todayClasses.filter((item) => item.position !== "PAST").length;
  const nav = [
    ["overview", "Overview", "/home"], ["calendar", "Agenda", "/agenda"], ["clock", "Timetable", "/timetable"],
    ["check", "Tasks & deadlines", "/work"], ["folder", "Projects", "/projects"],
    ["book", "Courses", "/courses"], ["note", "Notes", "/notes"], ["link", "Resources", "/resources"],
  ] as const;
  return <div className="dash-app">
    <a className="dash-skip" href="#dashboard-main">Skip to dashboard</a>
    <aside className="dash-sidebar">
      <Link href="/home" className="dash-brand" aria-label="UniOS home"><span className="dash-brand-mark">u<span>°</span></span>UniOS<span className="dash-brand-caption">YOUR ACADEMIC SPACE</span></Link>
      <p className="dash-nav-label">WORKSPACE</p>
      <nav aria-label="Academic navigation" className="dash-nav">{nav.map(([icon, label, href]) => <Link key={href} href={href} aria-current={href === "/home" ? "page" : undefined}><Icon name={icon} /><span>{label}</span>{href === "/home" && <span className="dash-nav-dot" />}</Link>)}</nav>
      <div className="dash-sidebar-bottom"><div className="dash-term-mini"><span className="dash-mini-icon"><Icon name="book" /></span><div><span>Selected term</span><Link href="/terms">{d.term.name} <span aria-hidden="true">↗</span></Link></div></div>
        <div className="dash-account"><span className="dash-avatar">{(firstName ?? "U").slice(0, 1).toUpperCase()}</span><div><strong>{d.displayName ?? "Your workspace"}</strong>{d.email && <span className="dash-email" title={d.email}>{d.email}</span>}</div></div><SignOutButton />
      </div>
    </aside>

    <div className="dash-workspace"><header className="dash-topbar"><span>My workspace <span className="dash-slash">/</span> <strong>Overview</strong></span><span className="dash-snapshot"><span className="dash-status-dot" />As of <time dateTime={d.now.toISOString()}>{viewerStamp(d.now, d.timezone).time}</time><span className="dash-top-zone"> · {d.timezone}</span></span><div className="dash-mobile-account"><SignOutButton /></div></header>
      <main id="dashboard-main" className="dash-main" tabIndex={-1}>
        <div className="dash-heading"><div><p className="dash-eyebrow"><Icon name="sun" size={16} /> A LITTLE CLARITY FOR YOUR DAY</p><h1>{greeting}{firstName ? `, ${firstName}` : ""}<span className="dash-heading-dot">.</span></h1><p>Your day, in focus. Make room for what matters.</p></div><div className="dash-heading-actions"><span className="dash-date"><Icon name="calendar" size={17} /><DateLabel date={d.today} full /></span><Link className="dash-button" href="/work?create=TASK#new-task"><Icon name="plus" size={17} />New task</Link></div></div>

        <section className="dash-stats" aria-label="Your day at a glance">
          <Link href="/agenda" className="dash-stat"><span className="dash-stat-icon green"><Icon name="calendar" /></span><div><span>Classes today</span><strong>{d.todayClasses.length}<small>{remaining ? `${remaining} still ahead or in progress` : "Your schedule is clear"}</small></strong></div><Icon name="arrow" size={16} /></Link>
          <Link href="/work?view=TODAY" className="dash-stat"><span className="dash-stat-icon amber"><Icon name="clock" /></span><div><span>Due today</span><strong>{d.dueTodayCount}<small>In each deadline’s timezone</small></strong></div><Icon name="arrow" size={16} /></Link>
          <Link href="/work?view=OVERDUE" className="dash-stat"><span className="dash-stat-icon rose"><Icon name="check" /></span><div><span>Overdue</span><strong>{d.overdueCount}<small>{d.overdueCount ? "A good place to start" : "Nothing left behind"}</small></strong></div><Icon name="arrow" size={16} /></Link>
          <Link href="/work?kind=TASK" className="dash-stat"><span className="dash-stat-icon lilac"><Icon name="note" /></span><div><span>Open tasks</span><strong>{d.taskCount}<small>Across your workspace</small></strong></div><Icon name="arrow" size={16} /></Link>
        </section>

        <div className="dash-content-grid"><div className="dash-primary">
          <section className="dash-card dash-schedule" aria-labelledby="schedule-heading"><div className="dash-card-heading"><div><p className="dash-eyebrow">YOUR DAILY RHYTHM</p><h2 id="schedule-heading">Today’s schedule <span className="dash-count">{d.todayClasses.length}</span></h2></div><Link className="dash-text-link" href="/agenda">View agenda <Icon name="arrow" size={16} /></Link></div>
            <p className="dash-card-description">Class times in {d.timezone}. From your selected term.</p>
            {d.todayClasses.length ? <ol className="dash-timeline">{d.todayClasses.slice(0, 6).map((item, index) => <li className={`dash-class ${item.position.toLowerCase()}`} key={agendaIdentity(item)}><div className="dash-class-time"><time dateTime={item.startsAt.toISOString()}>{item.viewerStartTime}</time><span>{item.viewerStartDate < d.today && "Prev day · "}{item.viewerEndTime}{item.viewerEndDate > d.today ? " +1 day" : ""}</span></div><div className="dash-timeline-track"><span /></div><Link href="/timetable" className="dash-class-content"><div className="dash-class-meta"><span className={`dash-course-code tone-${index % 4}`}>{item.course.code}</span>{item.position === "CURRENT" ? <Badge tone="green">Happening now</Badge> : item.position === "PAST" ? <Badge>Finished</Badge> : <span className="dash-class-upcoming">Upcoming</span>}{item.occurrenceState === "MOVED" && <Badge tone="amber">Rescheduled</Badge>}</div><h3>{item.title}</h3><p><Icon name="pin" size={14} />{item.location ?? "Location not set"}<span>·</span><ClassTime item={item} today={d.today} /></p>{item.effectiveTimezone !== d.timezone && <p className="dash-source">Schedule timezone: {item.effectiveTimezone}</p>}</Link></li>)}</ol> : <Empty icon="sun" title="A little breathing room" href="/timetable" action="Open timetable">No classes scheduled for today. Your time is yours to plan.</Empty>}
            {d.todayClasses.length > 6 && <Link className="dash-panel-footer" href="/agenda">View all {d.todayClasses.length} classes <Icon name="arrow" size={16} /></Link>}
          </section>

          <section className="dash-card" aria-labelledby="tasks-heading"><div className="dash-card-heading"><div><p className="dash-eyebrow">ONE THING AT A TIME</p><h2 id="tasks-heading">Your next priorities</h2></div><Link className="dash-text-link" href="/work?kind=TASK">All tasks <Icon name="arrow" size={16} /></Link></div><p className="dash-card-description">Overdue and due today first, then priority. Pick a task to manage it.</p>
            {d.tasks.length ? <ul className="dash-task-list">{d.tasks.map((item) => <li key={item.id}><Link href={workLink(item)} className="dash-task-link"><span className="dash-task-symbol"><Icon name={item.status === "IN_PROGRESS" ? "clock" : "check"} size={17} /></span><div><h3>{item.title}</h3><p><span>{item.status === "IN_PROGRESS" ? "In progress" : "To do"}</span><span>·</span><DeadlineLabel item={item} zone={d.timezone} /></p></div><Badge tone={item.deadline?.overdue ? "red" : item.priority === "URGENT" ? "red" : item.priority === "HIGH" ? "amber" : "neutral"}>{item.deadline?.overdue ? "Overdue" : item.priority.toLowerCase()}</Badge><Icon name="arrow" size={15} /></Link></li>)}</ul> : <Empty icon="check" title="A fresh page" href="/work?create=TASK#new-task" action="Create your first task">No open tasks right now. Capture your next small step when you’re ready.</Empty>}
            {d.taskCount > d.tasks.length && <Link href="/work?kind=TASK" className="dash-panel-footer">Showing {d.tasks.length} of {d.taskCount} open tasks <Icon name="arrow" size={16} /></Link>}
          </section>
        </div><div className="dash-secondary">
          <section className="dash-focus" aria-labelledby="focus-heading"><div className="dash-focus-label"><span className="dash-status-dot" />{d.currentClasses.length ? "IN PROGRESS" : "NEXT ON YOUR TIMETABLE"}<Icon name="clock" size={17} /></div><h2 id="focus-heading">{focus ? focus.course.code : "Space to focus"}</h2><p className="dash-focus-title">{focus ? focus.title : "No upcoming class in the next 30 days."}</p>{focus && <><p className="dash-focus-time"><ClassTime item={focus} today={d.today} /></p><p className="dash-focus-place"><Icon name="pin" size={14} />{focus.location ?? "Location not set"}</p></>}{d.currentClasses.length > 1 && <p className="dash-focus-place">{d.currentClasses.length} classes overlap right now. Check your agenda.</p>}<Link href={focus ? "/agenda?view=UPCOMING" : "/work"}>{focus ? "Open your agenda" : "Plan your next step"}<Icon name="arrow" size={17} /></Link><span className="dash-focus-orbit" aria-hidden="true" /></section>

          <section className="dash-card" aria-labelledby="deadlines-heading"><div className="dash-card-heading"><h2 id="deadlines-heading">Deadlines ahead</h2><span className="dash-small-icon"><Icon name="calendar" size={19} /></span></div><p className="dash-card-description">Overdue, due today & the next 30 days.</p>
            {d.deadlines.length ? <ul className="dash-deadline-list">{d.deadlines.map((item) => <li key={`${item.kind}-${item.id}`}><Link href={workLink(item)}><div className="dash-deadline-top"><span className={`dash-work-kind ${item.kind.toLowerCase()}`}>{item.kind.toLowerCase()}</span>{item.deadline!.overdue ? <Badge tone="red">Overdue</Badge> : item.deadline!.dueToday ? <Badge tone="amber">Due today</Badge> : <span className="dash-deadline-date"><DateLabel date={item.deadline!.date} /></span>}</div><h3>{item.title}</h3><p><DeadlineLabel item={item} zone={d.timezone} /></p></Link></li>)}</ul> : <Empty icon="calendar" title="Nothing pressing" href="/work" action="Open your work">No overdue or upcoming deadlines in this window.</Empty>}
            <Link href="/work" className="dash-panel-footer">{d.deadlineCount > d.deadlines.length ? `View all work · ${d.deadlineCount} deadlines in this window` : "View all work"}<Icon name="arrow" size={16} /></Link>
          </section>

          <section className="dash-card dash-academic" aria-labelledby="term-heading"><div className="dash-card-heading"><p className="dash-eyebrow">THE BIGGER PICTURE</p><Icon name="book" size={20} /></div><h2 id="term-heading">{d.term.name}</h2>{d.programme && <p className="dash-programme">{d.programme}</p>}<div className="dash-term-facts"><Badge tone={d.term.status === "ACTIVE" ? "green" : "neutral"}>{d.term.status.toLowerCase()}</Badge><span>{d.term.teachingWeek ? `Teaching week ${d.term.teachingWeek}` : "Outside teaching dates"}</span></div><p className="dash-term-dates"><DateLabel date={d.term.startsOn} /> — <DateLabel date={d.term.endsOn} /><span className="dash-source">Academic timezone: {d.term.timezone}</span></p>
            <div className="dash-course-list"><span className="dash-nav-label">{d.courseCount} CURRENT {d.courseCount === 1 ? "COURSE" : "COURSES"}</span>{d.courses.map((course, index) => <Link key={course.id} href={`/work?course=${course.id}`}><span className={`dash-course-dot tone-${index % 4}`} /><strong>{course.courseCode}</strong><span>{course.title}</span><Icon name="arrow" size={14} /></Link>)}{!d.courses.length && <p className="dash-card-description">Add a course to give your term some shape.</p>}</div><Link className="dash-panel-footer" href="/courses">Manage courses <Icon name="arrow" size={16} /></Link>
          </section>
        </div></div>
        <footer className="dash-footer"><span>A calmer place for your academic life.</span><span>Updated on page load · <a href="/home">Refresh overview</a></span></footer>
      </main>
    </div>
  </div>;
}
