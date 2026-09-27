import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeadlineFields } from "../src/app/work-fields";

for (const kind of ["TASK", "PROJECT", "ASSIGNMENT"]) {
  test(`${kind} rendered creation permits NONE; Add/Edit deadline selections offer only savable variants`, () => {
    function render(allowNone: boolean, data: Parameters<typeof DeadlineFields>[0]["data"] = {}) {
      return renderToStaticMarkup(createElement("form", {},
        createElement("input", { type: "hidden", name: "kind", value: kind }),
        createElement(DeadlineFields, { timezone: "Asia/Kuala_Lumpur", allowNone, data }),
      ));
    }
    function options(html: string) {
      const select = html.match(/<select\b[^>]*name="deadlineKind"[^>]*>([\s\S]*?)<\/select>/);
      assert.ok(select, "rendered deadline selection exists");
      return Array.from(select[1]!.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g), (match) => match[1]);
    }
    const creation = render(true);
    assert.deepEqual(options(creation), ["NONE", "DATE_ONLY", "TIMED"]);
    assert.match(creation, /<option selected="">NONE<\/option>/);
    assert.ok(!creation.includes('name="dueDate"'));
    const add = render(false);
    assert.deepEqual(options(add), ["DATE_ONLY", "TIMED"]);
    assert.match(add, /<option selected="">DATE_ONLY<\/option>/);
    assert.ok(add.includes('name="dueDate"'));
    for (const data of [
      { deadlineKind: "DATE_ONLY", dueDate: "2026-10-15", dueTimezone: "UTC" },
      { deadlineKind: "TIMED", dueAt: "2026-10-15T12:00:00.123Z", dueTimezone: "America/New_York" },
    ]) {
      const edit = render(false, data);
      assert.deepEqual(options(edit), ["DATE_ONLY", "TIMED"]);
      assert.ok(edit.includes(`<option selected="">${data.deadlineKind}</option>`));
      assert.ok(edit.includes(data.deadlineKind === "TIMED" ? 'name="dueAt"' : 'name="dueDate"'));
    }
  });
}
