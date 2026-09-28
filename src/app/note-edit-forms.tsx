type Note = { id: string; title: string; contentMarkdown: string; pinned: boolean; courseId: string | null };
type CourseOption = { id: string; label: string; disabled: boolean };
type Action = (form: FormData) => Promise<void>;

export function NoteEditForms({ note, courses, metadataAction, contentAction }: {
  note: Note; courses: CourseOption[]; metadataAction: Action; contentAction: Action;
}) {
  return <>
    <details><summary>Edit note metadata</summary><form action={metadataAction}>
      <input type="hidden" name="kind" value="NOTE" /><input type="hidden" name="id" value={note.id} />
      <label>Title<input name="title" defaultValue={note.title} required /></label>
      <label>Course<select name="courseId" defaultValue={note.courseId ?? ""}><option value="">Standalone</option>{courses.map((course) => <option key={course.id} value={course.id} disabled={course.disabled}>{course.label}</option>)}</select></label>
      <label>Pinned<select name="pinned" defaultValue={note.pinned ? "true" : "false"}><option value="false">No</option><option value="true">Yes</option></select></label>
      <button type="submit">Save note metadata</button>
    </form></details>
    <details><summary>Edit note content</summary><form action={contentAction}>
      <input type="hidden" name="kind" value="NOTE" /><input type="hidden" name="id" value={note.id} />
      <label>Content<textarea name="contentMarkdown" rows={8} defaultValue={note.contentMarkdown} /></label>
      <button type="submit">Save note content</button>
    </form></details>
  </>;
}
