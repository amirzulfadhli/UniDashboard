import assert from "node:assert/strict";
/* global document:readonly */

// Run through cua_repl with an authenticated disposable fixture, a Tab and the
// browser's viewport capability. No separate browser runtime or dependency.
export async function checkDashboardContents(tab, { taskCount, taskTitles, deadlineTitles }) {
  const actual = await tab.playwright.evaluate(() => ({
    error: document.body.innerText.includes("Your overview couldn’t load."),
    tasks: [...document.querySelectorAll(".dash-task-list h3")].map((element) => element.textContent),
    deadlines: [...document.querySelectorAll('[aria-labelledby="deadlines-heading"] h3')].map((element) => element.textContent),
    taskCount: document.querySelector('.dash-stat[href="/work?kind=TASK"] strong')?.firstChild?.textContent,
  }));
  assert.equal(actual.error, false);
  assert.equal(actual.taskCount, String(taskCount));
  // Browser values and caller inputs can cross different JavaScript realms.
  assert.equal(JSON.stringify(actual.tasks), JSON.stringify(taskTitles));
  assert.equal(JSON.stringify(actual.deadlines), JSON.stringify(deadlineTitles));
}

export async function checkDashboardLayout(tab, viewport, displayName) {
  const results = [];
  try {
    for (const width of [320, 375, 1440]) {
      await viewport.set({ width, height: 900 });
      const actual = await tab.playwright.evaluate(() => {
        const heading = document.querySelector("h1");
        return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          text: heading?.textContent, headingClient: heading?.clientWidth, headingScroll: heading?.scrollWidth };
      });
      assert.ok(actual.text.includes(displayName), "fixture must contain the complete long display name");
      assert.ok(actual.scroll <= actual.client, `page overflows at ${width}px`);
      assert.ok(actual.headingScroll <= actual.headingClient, `greeting overflows at ${width}px`);
      results.push({ width, ...actual });
    }
  } finally { await viewport.reset(); }
  return results;
}

export async function checkDashboardError(tab) {
  const message = await tab.playwright.getByRole("heading", { name: "Your overview couldn’t load.", exact: true }).innerText();
  assert.equal(message, "Your overview couldn’t load.");
  assert.equal(await tab.playwright.getByRole("link", { name: "Try again", exact: true }).getAttribute("href"), "/home");
  const body = await tab.playwright.evaluate(() => document.body.innerText);
  assert.ok(!/PrismaClient|P2021|P2028|public\.task/.test(body), "internal errors must stay hidden");
}

export async function retryDashboard(tab) {
  await tab.playwright.getByRole("link", { name: "Try again", exact: true }).click();
}
