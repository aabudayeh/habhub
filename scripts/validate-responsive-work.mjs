import assert from "node:assert/strict";

import { scheduleResponsiveWork } from "../src/domain/responsiveWork.ts";

function fakeDriver() {
  let nextTimerId = 1;
  const timers = new Map();
  const interactions = [];
  let quietFor = Number.POSITIVE_INFINITY;
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
      millisecondsSinceUserInteraction() {
        return quietFor;
      },
    },
    fireTimer(delayMs) {
      const match = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(match, `Expected a ${delayMs} ms timer`);
      timers.delete(match[0]);
      match[1].work();
    },
    fireInteraction() {
      let entry;
      while ((entry = interactions.shift())?.cancelled) {
        // Skip callbacks cancelled when a newer touch reset the quiet gate.
      }
      assert.ok(entry, "Expected queued interaction work");
      entry.work();
    },
    pendingTimers: () => timers.size,
    pendingInteractions: () => interactions.filter((entry) => !entry.cancelled).length,
    setQuietFor(value) {
      quietFor = value;
    },
  };
}

{
  const fake = fakeDriver();
  let runs = 0;
  fake.setQuietFor(50);
  scheduleResponsiveWork(fake.driver, () => (runs += 1), {
    maximumDelayMs: 1_000,
    minimumUserQuietMs: 500,
  });
  // Even the hard maintenance deadline must not land on a fresh native tap.
  fake.fireTimer(1_000);
  assert.equal(runs, 0);
  fake.setQuietFor(500);
  fake.fireTimer(450);
  fake.fireInteraction();
  assert.equal(runs, 1);
}

{
  const fake = fakeDriver();
  let runs = 0;
  fake.setQuietFor(0);
  scheduleResponsiveWork(fake.driver, () => (runs += 1), {
    maximumDelayMs: 1_000,
    minimumUserQuietMs: 1_500,
  });
  fake.fireTimer(1_000);
  assert.equal(runs, 0);
  // A fresh touch every second continues past the nominal maximum deadline.
  // Each interaction callback re-checks the real-touch clock before work.
  fake.setQuietFor(500);
  fake.fireTimer(1_500);
  fake.fireInteraction();
  for (let second = 2; second <= 6; second += 1) {
    fake.setQuietFor(500);
    fake.fireTimer(1_000);
    fake.fireInteraction();
    assert.equal(runs, 0, `heavy work ran during touch second ${second}`);
  }
  fake.setQuietFor(1_500);
  fake.fireTimer(1_000);
  fake.fireInteraction();
  assert.equal(runs, 1);
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
  "Responsive work validation passed (delay, hard deadline, real-touch quiet gate, cancellation, and synchronous interaction driver).",
);
