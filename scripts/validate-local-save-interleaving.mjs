import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the actual source-controlled persistence transaction loop, with only
// its TypeScript local annotation removed. No duplicated model implementation
// or app/user formula is evaluated by this trusted-code test harness.
const source = fs.readFileSync("src/state/AppProvider.tsx", "utf8");
const functionStart = source.indexOf("const persistLatestState = useCallback");
const start = source.indexOf("    let write: Promise<void>;", functionStart);
const returnMarker = "    return write;";
const end = source.indexOf(returnMarker, start) + returnMarker.length;
assert.ok(functionStart >= 0 && start > functionStart && end > start, "Locate the production save loop");
const loop = source.slice(start, end).replace("let write: Promise<void>;", "let write;");

const makeState = (version, account = "owner") => ({ currentUserId: account, version, entries: [], gymSessions: [], settings: {} });
async function exercise({ editDuringCleanup = false, cleanupRejects = false, backgroundAdoption = false, editDuringWrite = false, switchAccount = false, writeRejects = false } = {}) {
  const initial = makeState(1);
  const refs = {
    persistenceDirtyRef: { current: true },
    persistenceRevisionRef: { current: 1 },
    persistenceStateRef: { current: initial },
    persistenceObservedStateRef: { current: initial },
    persistenceWriteRef: { current: null },
  };
  const saved = [], retired = [], rendered = [];
  let yields = 0, localPublications = 0;
  const edit = () => {
    refs.persistenceStateRef.current = makeState(2, switchAccount ? "next-account" : "owner");
    refs.persistenceRevisionRef.current += 1;
    refs.persistenceDirtyRef.current = true;
    // Like commitReducedState, a new edit marks dirty immediately. Scheduling
    // sees this already-active writer and does not create a replacement timer.
    assert.ok(refs.persistenceWriteRef.current, "Edit lands while the original writer is active");
  };
  const context = {
    ...refs,
    deferForegroundTurn: async () => { yields++; await Promise.resolve(); },
    persistAppStateNow: async (state) => {
      await Promise.resolve();
      if (writeRejects) throw new Error("storage unavailable");
      saved.push(state);
      if (editDuringWrite && saved.length === 1) edit();
      return backgroundAdoption && saved.length === 1 ? { ...state, settings: { receiptApplied: true } } : state;
    },
    retireBackgroundWorkoutCompletionIfResolved: async (accountId) => {
      retired.push(accountId);
      await Promise.resolve();
      if (editDuringCleanup && retired.length === 1) edit();
      if (cleanupRejects) throw new Error("receipt cleanup deferred");
      return true;
    },
    dispatch: (action) => rendered.push(action.state),
    setLocalMutationRevision: () => { localPublications++; },
  };
  const flush = vm.runInNewContext(`(async function(immediate) { ${loop} })`, context, { timeout: 1000 });
  if (writeRejects) {
    await assert.rejects(flush(true), /storage unavailable/);
    assert.equal(refs.persistenceDirtyRef.current, true, "Failed storage never acknowledges dirty work");
  } else {
    await flush(true);
    assert.equal(refs.persistenceDirtyRef.current, false);
  }
  assert.equal(refs.persistenceWriteRef.current, null, "Single-flight writer is released after completion/failure");
  return { saved, retired, rendered, yields, localPublications, refs };
}

const ordinary = await exercise();
assert.deepEqual(ordinary.saved.map((state) => state.version), [1]);
assert.deepEqual(ordinary.retired, ["owner"]);
assert.equal(ordinary.yields, 0, "An unchanged successful save needs no extra pass");
for (const cleanupRejects of [false, true]) {
  const raced = await exercise({ editDuringCleanup: true, cleanupRejects });
  assert.deepEqual(raced.saved.map((state) => state.version), [1, 2], "Edit during awaited receipt cleanup is saved by the same writer");
  assert.equal(raced.refs.persistenceStateRef.current.version, 2);
  assert.equal(raced.yields, 1, "A newer save gets one UI-friendly yield, without a retry spin");
}
const adopted = await exercise({ backgroundAdoption: true, editDuringCleanup: true });
assert.equal(adopted.localPublications, 1, "Successful persisted background reconciliation is still published");
assert.equal(adopted.rendered[0].settings.receiptApplied, true);
assert.deepEqual(adopted.saved.map((state) => state.version), [1, 2]);
const changedDuringWrite = await exercise({ editDuringWrite: true });
assert.deepEqual(changedDuringWrite.saved.map((state) => state.version), [1, 2]);
assert.equal(changedDuringWrite.retired.length, 1, "A superseded storage result cannot retire a newer receipt prematurely");
const switched = await exercise({ editDuringCleanup: true, switchAccount: true });
assert.deepEqual(switched.saved.map((state) => state.currentUserId), ["owner", "next-account"]);
assert.deepEqual(switched.retired, ["owner", "next-account"], "Receipt cleanup remains scoped to the account that was actually persisted");
await exercise({ writeRejects: true });
console.log("Local save interleaving passed: production loop preserves edits/account switches during awaited receipt cleanup, background adoption, cleanup failure and single-flight release.");
