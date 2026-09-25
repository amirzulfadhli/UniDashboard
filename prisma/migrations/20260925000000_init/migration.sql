-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "DeadlineKind" AS ENUM ('NONE', 'DATE_ONLY', 'TIMED');

-- CreateEnum
CREATE TYPE "EventTemporalKind" AS ENUM ('ALL_DAY', 'TIMED');

-- CreateEnum
CREATE TYPE "ScheduleExceptionKind" AS ENUM ('CANCEL', 'MOVE');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_TO_SUBMIT', 'SUBMITTED', 'GRADED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile" (
    "owner_id" UUID NOT NULL,
    "display_name" TEXT,
    "timezone" TEXT NOT NULL,
    "selected_term_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("owner_id")
);

-- CreateTable
CREATE TABLE "programme" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "teaching_starts_on" DATE NOT NULL,
    "academic_timezone" TEXT NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'PLANNED',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activated_at" TIMESTAMPTZ(3),
    "last_closed_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "course_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "first_dependant_at" TIMESTAMPTZ(3),
    "status" "CourseStatus" NOT NULL DEFAULT 'UPCOMING',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activated_at" TIMESTAMPTZ(3),
    "last_completed_at" TIMESTAMPTZ(3),
    "last_cancelled_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "last_reinstated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "local_start_time" TIME(0) NOT NULL,
    "local_end_time" TIME(0) NOT NULL,
    "end_day_offset" SMALLINT NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL,
    "original_start_date" DATE NOT NULL,
    "original_end_date" DATE NOT NULL,
    "retired_from_date" DATE,
    "location" TEXT,
    "predecessor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedule_exception" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "original_date" DATE NOT NULL,
    "kind" "ScheduleExceptionKind" NOT NULL,
    "replacement_starts_at" TIMESTAMPTZ(3),
    "replacement_ends_at" TIMESTAMPTZ(3),
    "replacement_timezone" TEXT,
    "replacement_location" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_schedule_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "deadline_kind" "DeadlineKind" NOT NULL DEFAULT 'NONE',
    "due_date" DATE,
    "due_at" TIMESTAMPTZ(3),
    "due_timezone" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_submitted_at" TIMESTAMPTZ(3),
    "last_graded_at" TIMESTAMPTZ(3),
    "last_cancelled_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "last_reinstated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "term_id" UUID,
    "course_id" UUID,
    "assignment_id" UUID,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "deadline_kind" "DeadlineKind" NOT NULL DEFAULT 'NONE',
    "due_date" DATE,
    "due_at" TIMESTAMPTZ(3),
    "due_timezone" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_completed_at" TIMESTAMPTZ(3),
    "last_cancelled_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "last_reinstated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "course_id" UUID,
    "home_term_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "deadline_kind" "DeadlineKind" NOT NULL DEFAULT 'NONE',
    "due_date" DATE,
    "due_at" TIMESTAMPTZ(3),
    "due_timezone" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activated_at" TIMESTAMPTZ(3),
    "last_completed_at" TIMESTAMPTZ(3),
    "last_cancelled_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "last_reinstated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "course_id" UUID,
    "title" TEXT NOT NULL,
    "content_markdown" TEXT NOT NULL DEFAULT '',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "course_id" UUID,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "term_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "temporal_kind" "EventTemporalKind" NOT NULL,
    "all_day_starts_on" DATE,
    "all_day_ends_on" DATE,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "interpretation_timezone" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_cancelled_at" TIMESTAMPTZ(3),
    "last_reinstated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_id" UUID NOT NULL,
    "term_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurs_on" DATE NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_selected_term_id_key" ON "profile"("selected_term_id");

-- CreateIndex
CREATE UNIQUE INDEX "programme_owner_id_key" ON "programme"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "term_owner_id_id_key" ON "term"("owner_id", "id");

-- CreateIndex
CREATE INDEX "course_term_id_owner_id_status_archived_at_idx" ON "course"("term_id", "owner_id", "status", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_owner_id_id_key" ON "course"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_schedule_predecessor_id_key" ON "class_schedule"("predecessor_id");

-- CreateIndex
CREATE INDEX "class_schedule_course_id_owner_id_idx" ON "class_schedule"("course_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_schedule_owner_id_id_key" ON "class_schedule"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_schedule_owner_id_course_id_id_key" ON "class_schedule"("owner_id", "course_id", "id");

-- CreateIndex
CREATE INDEX "class_schedule_exception_owner_id_replacement_starts_at_idx" ON "class_schedule_exception"("owner_id", "replacement_starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "class_schedule_exception_schedule_id_original_date_key" ON "class_schedule_exception"("schedule_id", "original_date");

-- CreateIndex
CREATE INDEX "assignment_course_id_owner_id_idx" ON "assignment"("course_id", "owner_id");

-- CreateIndex
CREATE INDEX "assignment_owner_id_status_due_at_idx" ON "assignment"("owner_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "assignment_owner_id_status_due_date_idx" ON "assignment"("owner_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_owner_id_id_key" ON "assignment"("owner_id", "id");

-- CreateIndex
CREATE INDEX "task_term_id_owner_id_idx" ON "task"("term_id", "owner_id");

-- CreateIndex
CREATE INDEX "task_course_id_owner_id_idx" ON "task"("course_id", "owner_id");

-- CreateIndex
CREATE INDEX "task_assignment_id_owner_id_idx" ON "task"("assignment_id", "owner_id");

-- CreateIndex
CREATE INDEX "task_project_id_owner_id_idx" ON "task"("project_id", "owner_id");

-- CreateIndex
CREATE INDEX "task_owner_id_status_due_at_idx" ON "task"("owner_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "task_owner_id_status_due_date_idx" ON "task"("owner_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "project_course_id_owner_id_idx" ON "project"("course_id", "owner_id");

-- CreateIndex
CREATE INDEX "project_home_term_id_owner_id_idx" ON "project"("home_term_id", "owner_id");

-- CreateIndex
CREATE INDEX "project_owner_id_status_due_at_idx" ON "project"("owner_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "project_owner_id_status_due_date_idx" ON "project"("owner_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "project_owner_id_id_key" ON "project"("owner_id", "id");

-- CreateIndex
CREATE INDEX "note_course_id_owner_id_idx" ON "note"("course_id", "owner_id");

-- CreateIndex
CREATE INDEX "note_owner_id_archived_at_updated_at_id_idx" ON "note"("owner_id", "archived_at", "updated_at" DESC, "id");

-- CreateIndex
CREATE INDEX "resource_owner_id_idx" ON "resource"("owner_id");

-- CreateIndex
CREATE INDEX "resource_course_id_owner_id_idx" ON "resource"("course_id", "owner_id");

-- CreateIndex
CREATE INDEX "event_term_id_owner_id_idx" ON "event"("term_id", "owner_id");

-- CreateIndex
CREATE INDEX "event_owner_id_starts_at_idx" ON "event"("owner_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_owner_id_all_day_starts_on_idx" ON "event"("owner_id", "all_day_starts_on");

-- CreateIndex
CREATE INDEX "milestone_term_id_owner_id_idx" ON "milestone"("term_id", "owner_id");

-- CreateIndex
CREATE INDEX "milestone_owner_id_occurs_on_id_idx" ON "milestone"("owner_id", "occurs_on", "id");

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "profile" ADD CONSTRAINT "profile_selected_term_id_fkey" FOREIGN KEY ("selected_term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "programme" ADD CONSTRAINT "programme_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "course" ADD CONSTRAINT "course_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "class_schedule" ADD CONSTRAINT "class_schedule_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "class_schedule" ADD CONSTRAINT "class_schedule_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "class_schedule" ADD CONSTRAINT "class_schedule_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "class_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "class_schedule_exception" ADD CONSTRAINT "class_schedule_exception_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "class_schedule_exception" ADD CONSTRAINT "class_schedule_exception_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_home_term_id_fkey" FOREIGN KEY ("home_term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "resource" ADD CONSTRAINT "resource_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "resource" ADD CONSTRAINT "resource_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "term"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ### A. Owner-qualified foreign keys
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('profile', 'selected_term_id', 'term'),
      ('course', 'term_id', 'term'),
      ('assignment', 'course_id', 'course'),
      ('class_schedule', 'course_id', 'course'),
      ('class_schedule_exception', 'schedule_id', 'class_schedule'),
      ('task', 'term_id', 'term'),
      ('task', 'course_id', 'course'),
      ('task', 'assignment_id', 'assignment'),
      ('task', 'project_id', 'project'),
      ('project', 'course_id', 'course'),
      ('project', 'home_term_id', 'term'),
      ('note', 'course_id', 'course'),
      ('resource', 'course_id', 'course'),
      ('event', 'term_id', 'term'),
      ('milestone', 'term_id', 'term')
    ) AS x(child_table, parent_column, parent_table)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I
       ADD CONSTRAINT %I
       FOREIGN KEY (owner_id, %I)
       REFERENCES public.%I (owner_id, id)
       MATCH SIMPLE
       ON DELETE RESTRICT ON UPDATE RESTRICT',
      r.child_table,
      r.child_table || '_' || r.parent_column || '_owner_fk',
      r.parent_column,
      r.parent_table
    );
  END LOOP;
END $$;

ALTER TABLE public.class_schedule
  ADD CONSTRAINT schedule_predecessor_context_fk
  FOREIGN KEY (owner_id, course_id, predecessor_id)
  REFERENCES public.class_schedule (owner_id, course_id, id)
  MATCH SIMPLE
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ### B. Deadline variants
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task', 'assignment', 'project']
  LOOP
    EXECUTE format(
      $sql$
      ALTER TABLE public.%I
      ADD CONSTRAINT %I
      CHECK ((
        (
          deadline_kind = 'NONE'
          AND due_date IS NULL
          AND due_at IS NULL
          AND due_timezone IS NULL
        )
        OR
        (
          deadline_kind = 'DATE_ONLY'
          AND due_date IS NOT NULL
          AND due_at IS NULL
          AND due_timezone IS NOT NULL
          AND due_timezone ~ '[^[:space:]]'
        )
        OR
        (
          deadline_kind = 'TIMED'
          AND due_date IS NULL
          AND due_at IS NOT NULL
          AND due_timezone IS NOT NULL
          AND due_timezone ~ '[^[:space:]]'
        )
      ) IS TRUE)
      $sql$,
      t, t || '_deadline_variant_ck'
    );
  END LOOP;
END $$;

-- ### C. Event, Task, Project, and Term CHECKs
ALTER TABLE public.event
  ADD CONSTRAINT event_temporal_variant_ck
  CHECK ((
    (
      temporal_kind = 'ALL_DAY'
      AND all_day_starts_on IS NOT NULL
      AND all_day_ends_on IS NOT NULL
      AND all_day_ends_on >= all_day_starts_on
      AND starts_at IS NULL
      AND ends_at IS NULL
      AND interpretation_timezone IS NULL
    )
    OR
    (
      temporal_kind = 'TIMED'
      AND all_day_starts_on IS NULL
      AND all_day_ends_on IS NULL
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at > starts_at
      AND interpretation_timezone IS NOT NULL
      AND interpretation_timezone ~ '[^[:space:]]'
    )
  ) IS TRUE);

ALTER TABLE public.task
  ADD CONSTRAINT task_assignment_context_ck
  CHECK (
    assignment_id IS NULL
    OR (course_id IS NULL AND term_id IS NULL)
  ),
  ADD CONSTRAINT task_course_context_ck
  CHECK (
    course_id IS NULL
    OR (term_id IS NULL AND project_id IS NULL)
  );

ALTER TABLE public.project
  ADD CONSTRAINT project_context_ck
  CHECK (course_id IS NULL OR home_term_id IS NULL);

ALTER TABLE public.term
  ADD CONSTRAINT term_dates_ck
  CHECK (
    ends_on >= starts_on
    AND teaching_starts_on BETWEEN starts_on AND ends_on
  );

-- ### D. Recurrence CHECKs
ALTER TABLE public.class_schedule
  ADD CONSTRAINT schedule_weekday_ck
    CHECK (weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT schedule_day_offset_ck
    CHECK (end_day_offset IN (0, 1)),
  ADD CONSTRAINT schedule_clock_bounds_ck
    CHECK (
      local_start_time < TIME '24:00:00'
      AND local_end_time < TIME '24:00:00'
    ),
  ADD CONSTRAINT schedule_duration_ck
    CHECK (
      local_end_time - local_start_time
        + end_day_offset * INTERVAL '1 day' > INTERVAL '0 seconds'
      AND
      local_end_time - local_start_time
        + end_day_offset * INTERVAL '1 day' <= INTERVAL '1 day'
    ),
  ADD CONSTRAINT schedule_original_range_ck
    CHECK (original_end_date >= original_start_date),
  ADD CONSTRAINT schedule_retirement_ck
    CHECK (
      retired_from_date IS NULL
      OR (
        retired_from_date BETWEEN original_start_date AND original_end_date
        AND EXTRACT(ISODOW FROM retired_from_date) = weekday
      )
    ),
  ADD CONSTRAINT schedule_not_self_predecessor_ck
    CHECK (predecessor_id IS NULL OR predecessor_id <> id);

ALTER TABLE public.class_schedule_exception
  ADD CONSTRAINT schedule_exception_payload_ck
  CHECK ((
    (
      kind = 'CANCEL'
      AND replacement_starts_at IS NULL
      AND replacement_ends_at IS NULL
      AND replacement_timezone IS NULL
      AND replacement_location IS NULL
    )
    OR
    (
      kind = 'MOVE'
      AND replacement_starts_at IS NOT NULL
      AND replacement_ends_at IS NOT NULL
      AND replacement_ends_at > replacement_starts_at
      AND replacement_timezone IS NOT NULL
      AND replacement_timezone ~ '[^[:space:]]'
    )
  ) IS TRUE);

-- ### E. Lifecycle evidence and archive CHECKs
ALTER TABLE public.term
  ADD CONSTRAINT term_closed_evidence_ck
    CHECK (status <> 'CLOSED' OR last_closed_at IS NOT NULL),
  ADD CONSTRAINT term_active_evidence_ck
    CHECK (
      status <> 'ACTIVE'
      OR last_activated_at IS NOT NULL
      OR last_reopened_at IS NOT NULL
    );

ALTER TABLE public.course
  ADD CONSTRAINT course_completed_evidence_ck
    CHECK (status <> 'COMPLETED' OR last_completed_at IS NOT NULL),
  ADD CONSTRAINT course_cancelled_evidence_ck
    CHECK (status <> 'CANCELLED' OR last_cancelled_at IS NOT NULL),
  ADD CONSTRAINT course_active_evidence_ck
    CHECK (
      status <> 'ACTIVE'
      OR last_activated_at IS NOT NULL
      OR last_reopened_at IS NOT NULL
      OR last_reinstated_at IS NOT NULL
    );

ALTER TABLE public.assignment
  ADD CONSTRAINT assignment_submission_evidence_ck
    CHECK (
      status NOT IN ('SUBMITTED', 'GRADED')
      OR last_submitted_at IS NOT NULL
    ),
  ADD CONSTRAINT assignment_grading_evidence_ck
    CHECK (status <> 'GRADED' OR last_graded_at IS NOT NULL),
  ADD CONSTRAINT assignment_cancelled_evidence_ck
    CHECK (status <> 'CANCELLED' OR last_cancelled_at IS NOT NULL),
  ADD CONSTRAINT assignment_archive_ck
    CHECK (
      archived_at IS NULL
      OR status IN ('SUBMITTED', 'GRADED', 'CANCELLED')
    );

ALTER TABLE public.task
  ADD CONSTRAINT task_completed_evidence_ck
    CHECK (status <> 'DONE' OR last_completed_at IS NOT NULL),
  ADD CONSTRAINT task_cancelled_evidence_ck
    CHECK (status <> 'CANCELLED' OR last_cancelled_at IS NOT NULL),
  ADD CONSTRAINT task_archive_ck
    CHECK (
      archived_at IS NULL
      OR status IN ('DONE', 'CANCELLED')
    );

ALTER TABLE public.project
  ADD CONSTRAINT project_completed_evidence_ck
    CHECK (status <> 'COMPLETED' OR last_completed_at IS NOT NULL),
  ADD CONSTRAINT project_cancelled_evidence_ck
    CHECK (status <> 'CANCELLED' OR last_cancelled_at IS NOT NULL),
  ADD CONSTRAINT project_active_evidence_ck
    CHECK (
      status <> 'ACTIVE'
      OR last_activated_at IS NOT NULL
      OR last_reopened_at IS NOT NULL
      OR last_reinstated_at IS NOT NULL
    );

ALTER TABLE public.event
  ADD CONSTRAINT event_cancelled_evidence_ck
    CHECK (status <> 'CANCELLED' OR last_cancelled_at IS NOT NULL);

ALTER TABLE public.resource
  ADD CONSTRAINT resource_http_url_ck
    CHECK (url ~* '^https?://[^[:space:]]+$');

-- ### F. Finite temporal values and nonblank labels
DO $$
DECLARE
  r record;
  tables text[] := ARRAY[
    'app_user', 'profile', 'programme', 'term', 'course',
    'class_schedule', 'class_schedule_exception',
    'assignment', 'task', 'project', 'note', 'resource',
    'event', 'milestone'
  ];
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(tables)
      AND data_type IN ('date', 'timestamp with time zone')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I
       CHECK (%I IS NULL OR isfinite(%I))',
      r.table_name,
      r.table_name || '_' || r.column_name || '_finite_ck',
      r.column_name, r.column_name
    );
  END LOOP;

  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(tables)
      AND column_name IN (
        'name', 'title', 'course_code', 'display_name',
        'timezone', 'academic_timezone', 'due_timezone',
        'interpretation_timezone', 'replacement_timezone',
        'location', 'replacement_location'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I
       CHECK (%I IS NULL OR %I ~ ''[^[:space:]]'')',
      r.table_name,
      r.table_name || '_' || r.column_name || '_nonblank_ck',
      r.column_name, r.column_name
    );
  END LOOP;
END $$;

-- ### G. Metadata, evidence, and immutable-identity guard
CREATE FUNCTION public.unios_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  immutable_keys text[] := ARRAY['id', 'owner_id', 'created_at'];
  field_name text;
  old_value jsonb;
  new_value jsonb;
BEGIN
  IF TG_TABLE_NAME = 'class_schedule' THEN
    immutable_keys := immutable_keys || ARRAY[
      'course_id', 'weekday', 'local_start_time', 'local_end_time',
      'end_day_offset', 'timezone', 'original_start_date',
      'original_end_date', 'location', 'predecessor_id'
    ];
  ELSIF TG_TABLE_NAME = 'class_schedule_exception' THEN
    immutable_keys := immutable_keys || ARRAY[
      'schedule_id', 'original_date'
    ];
  END IF;

  FOREACH field_name IN ARRAY immutable_keys
  LOOP
    IF old_row -> field_name IS DISTINCT FROM new_row -> field_name THEN
      RAISE EXCEPTION 'Immutable field: %.%', TG_TABLE_NAME, field_name
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR field_name, old_value IN
    SELECT key, value
    FROM jsonb_each(old_row)
    WHERE left(key, 5) = 'last_'
      AND right(key, 3) = '_at'
      AND value <> 'null'::jsonb
  LOOP
    new_value := new_row -> field_name;

    IF new_value IS NULL OR new_value = 'null'::jsonb THEN
      RAISE EXCEPTION 'Outcome evidence cannot be cleared: %', field_name
        USING ERRCODE = '23514';
    END IF;

    IF (new_value #>> '{}')::timestamptz
       < (old_value #>> '{}')::timestamptz THEN
      RAISE EXCEPTION 'Outcome evidence cannot move backwards: %', field_name
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_TABLE_NAME = 'course' THEN
    IF OLD.first_dependant_at IS NOT NULL THEN
      IF NEW.first_dependant_at IS DISTINCT FROM OLD.first_dependant_at THEN
        RAISE EXCEPTION 'Course context lock cannot change'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.term_id IS DISTINCT FROM OLD.term_id THEN
        RAISE EXCEPTION 'Course Term is locked'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'class_schedule' THEN
    IF OLD.retired_from_date IS NOT NULL
       AND (
         NEW.retired_from_date IS NULL
         OR NEW.retired_from_date > OLD.retired_from_date
       ) THEN
      RAISE EXCEPTION 'A retired series cannot be extended'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'profile', 'programme', 'term', 'course',
    'class_schedule', 'class_schedule_exception',
    'assignment', 'task', 'project', 'note', 'resource',
    'event', 'milestone'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.unios_guard_update()',
      t || '_guard_update', t
    );
  END LOOP;
END $$;

-- ### H. Course first-dependant triggers
CREATE FUNCTION public.unios_lock_course_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.course_id IS NOT DISTINCT FROM OLD.course_id THEN
      RETURN NEW;
    END IF;
  END IF;

  UPDATE public.course
  SET first_dependant_at = statement_timestamp()
  WHERE id = NEW.course_id
    AND owner_id = NEW.owner_id
    AND first_dependant_at IS NULL;

  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assignment', 'class_schedule', 'note',
    'resource', 'task', 'project'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I
       AFTER INSERT OR UPDATE OF course_id ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.unios_lock_course_context()',
      t || '_lock_course_context', t
    );
  END LOOP;
END $$;
