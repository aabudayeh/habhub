import { useCallback, useSyncExternalStore } from "react";

export type TodoEditorDraftNode<T> = {
  id: string;
  parentId?: string;
  title: string;
  value: T;
};

type DraftTree = {
  nodes: readonly TodoEditorDraftNode<unknown>[];
  listeners: Set<() => void>;
};

const EMPTY_NODES: readonly TodoEditorDraftNode<never>[] = [];
const draftTrees = new Map<string, DraftTree>();

function treeFor(treeId: string) {
  let tree = draftTrees.get(treeId);
  if (!tree) {
    tree = { nodes: EMPTY_NODES, listeners: new Set() };
    draftTrees.set(treeId, tree);
  }
  return tree;
}

function publish(tree: DraftTree, nodes: readonly TodoEditorDraftNode<unknown>[]) {
  tree.nodes = nodes;
  for (const listener of [...tree.listeners]) listener();
}

export function newTodoEditorDraftId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getTodoEditorDraftNodes<T>(treeId: string) {
  return (draftTrees.get(treeId)?.nodes ?? EMPTY_NODES) as readonly TodoEditorDraftNode<T>[];
}

export function upsertTodoEditorDraft<T>(
  treeId: string,
  node: TodoEditorDraftNode<T>,
) {
  const tree = treeFor(treeId);
  publish(tree, [
    ...tree.nodes.filter((item) => item.id !== node.id),
    node as TodoEditorDraftNode<unknown>,
  ]);
}

export function removeTodoEditorDraftSubtree(treeId: string, nodeId: string) {
  const tree = draftTrees.get(treeId);
  if (!tree) return;
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of tree.nodes)
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
  }
  publish(
    tree,
    tree.nodes.filter((node) => !removed.has(node.id)),
  );
}

export function orderTodoEditorDraftNodes<T>(
  nodes: readonly TodoEditorDraftNode<T>[],
  initiallyResolvedIds: Iterable<string> = [],
) {
  const pending = [...nodes];
  const ordered: TodoEditorDraftNode<T>[] = [];
  const resolved = new Set(initiallyResolvedIds);
  while (pending.length) {
    const pendingIds = new Set(pending.map((node) => node.id));
    const nextIndex = pending.findIndex(
      (node) =>
        !node.parentId ||
        resolved.has(node.parentId) ||
        !pendingIds.has(node.parentId),
    );
    if (nextIndex < 0)
      throw new Error("The nested to-do draft contains an unresolved cycle.");
    const [next] = pending.splice(nextIndex, 1);
    ordered.push(next);
    resolved.add(next.id);
  }
  return ordered;
}

export function resolveTodoEditorDraftParentId(
  parentId: string | undefined,
  persistedIdsByDraftId: ReadonlyMap<string, string>,
) {
  return parentId ? persistedIdsByDraftId.get(parentId) ?? parentId : undefined;
}

export function clearTodoEditorDraftTree(treeId: string) {
  const tree = draftTrees.get(treeId);
  if (!tree) return;
  publish(tree, EMPTY_NODES);
  if (!tree.listeners.size) draftTrees.delete(treeId);
}

export function useTodoEditorDraftTree<T>(treeId: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const tree = treeFor(treeId);
      tree.listeners.add(listener);
      return () => {
        tree.listeners.delete(listener);
        if (!tree.listeners.size && !tree.nodes.length)
          draftTrees.delete(treeId);
      };
    },
    [treeId],
  );
  const getSnapshot = useCallback(
    () => getTodoEditorDraftNodes<T>(treeId),
    [treeId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
