import assert from "node:assert/strict";

import { scheduleResponsiveWork } from "../src/domain/responsiveWork.ts";

function fakeDriver() {
  let nextTimerId = 1;
  const timers = new Map();
  const interactions = [];
  return {
    driver: {
      afterInteractions(work) {
        const entry = { cancelled: false, work };
        interactions.push(entry);
        return { cancel: () => (entry.cancelled = true) };
      },
      setTimer(work, delayMs) {
        const id = nextTimerId++;
        timers.set(id, { delayMs, work });
        return id;
      },
      clearTimer(id) {
        timers.delete(id);
      },
    },
    fireTimer(delayMs) {
      const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(match, `Expected a ${delayMs} ms timer`);
      timers.delete(match[0]);
      match[1].work();
    },
    fireInteraction() {
      const entry = interactions.shift();
      assert.ok(entry, "Expected queued interaction work");
      if (!entry.cancelled) entry.work();
    },
    pendingTimers: () => timers.size,
    pendingInteractions: () => interactions.filter((entry) => !entry.cancelled).length,
  };
}

{
  const fake = fakeDriver();
  let runs = 0;
  scheduleResponsiveWork(fake.driver, () => (runs += 1), {
    minimumDelayMs: 200,
    maximumDelayMs: 2_000,
  });
  assert.equal(runs, 0);
  assert.equal(fake.pendingInteractions(), 0);
  fake.fireTimer(200);
  assert.equal(fake.pendingInteractions(), 1);
  fake.fireInteraction();
  assert.equal(runs, 1);
  assert.equal(fake.pendingTimers(), 0);
}

{
  const fake = fakeDriver();
  let runs = 0;
  scheduleResponsiveWork(fake.driver, () => (runs += 1), {
    minimumDelayMs: 300,
    maximumDelayMs: 1_000,
  });
  fake.fireTimer(1_000);
  assert.equal(runs, 1, "the durability deadline must run busy-loop work");
  assert.equal(fake.pendingTimers(), 0);
  assert.equal(fake.pendingInteractions(), 0);
}

{
  const fake = fakeDriver();
  let runs = 0;
  const task = scheduleResponsiveWork(fake.driver, () => (runs += 1), {
    maximumDelayMs: 1_000,
  });
  assert.equal(fake.pendingInteractions(), 1);
  task.cancel();
  assert.equal(fake.pendingTimers(), 0);
  assert.equal(fake.pendingInteractions(), 0);
  assert.equal(runs, 0);
}

{
  let timerCleared = false;
  let interactionCancelled = false;
  let runs = 0;
  scheduleResponsiveWork(
    {
      afterInteractions(work) {
        work();
        return { cancel: () => (interactionCancelled = true) };
      },
      setTimer() {
        return 1;
      },
      clearTimer() {
        timerCleared = true;
      },
    },
    () => (runs += 1),
  );
  assert.equal(runs, 1);
  assert.equal(timerCleared, true);
  assert.equal(interactionCancelled, true);
}

console.log(
  "Responsive work validation passed (quiet-window, hard deadline, cancellation, and synchronous interaction driver).",
);
