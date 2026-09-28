import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteContent, ResourceLink } from "../src/knowledge/presentation";
import { NoteEditForms } from "../src/app/note-edit-forms";

test("rendered Note edit forms keep metadata separate from browser-normalized textarea content", async () => {
  const source = "\n  alpha\nbeta\r\ngamma\tdelta\rend😀  ";
  const html = renderToStaticMarkup(createElement(NoteEditForms, {
    note: { id: "note-id", title: "Original", contentMarkdown: source, pinned: false, courseId: null },
    courses: [{ id: "course-id", label: "Course", disabled: false }],
    metadataAction: async () => {}, contentAction: async () => {},
  }));
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([form]) => form);
  assert.equal(forms.length, 2);
  const metadata = forms.find((form) => form.includes('name="title"'));
  const content = forms.find((form) => form.includes('name="contentMarkdown"'));
  assert.ok(metadata && content);
  assert.ok(metadata.includes('name="pinned"') && metadata.includes('name="courseId"'));
  assert.ok(!metadata.includes('name="contentMarkdown"'));
  assert.ok(content?.includes('<textarea name="contentMarkdown"'));
  assert.ok(!content.includes('name="title"') && !content.includes('name="courseId"') && !content.includes('name="pinned"'));
  const browserForm = new FormData(); browserForm.set("contentMarkdown", source);
  assert.notEqual((await new Response(browserForm).formData()).get("contentMarkdown"), source, "form submission normalizes mixed line endings; metadata must omit this field");
});
test("Note HTML/script/Markdown source is escaped text with whitespace retained", () => {
  const content = '  # Source\n<script>alert("x")</script> <b>text</b> & \'quotes\'\n';
  const html = renderToStaticMarkup(createElement(NoteContent, { content }));
  assert.ok(html.includes("  # Source\n")); assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;text&lt;/b&gt; &amp; &#x27;quotes&#x27;")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<b>"));
});
test("Resource links escape labels/attributes, protect new tabs and refuse unsafe legacy URLs", () => {
  const html = renderToStaticMarkup(createElement(ResourceLink, { url: 'https://example.com/path?x="y"&z=1', title: '<script>alert("x")</script> & label' }));
  assert.ok(html.includes('rel="noopener noreferrer"')); assert.ok(html.includes('target="_blank"')); assert.ok(html.includes('href="https://example.com/path?x=&quot;y&quot;&amp;z=1"'));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>"));
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//example.com", "https://user:pass@example.com", "http://", "https://example.com/\n"]) {
    const unsafe = renderToStaticMarkup(createElement(ResourceLink, { url, title: "Unsafe" })); assert.ok(!unsafe.includes("href=")); assert.ok(!unsafe.includes("<a"));
  }
});
