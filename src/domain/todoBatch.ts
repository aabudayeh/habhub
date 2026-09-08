import { extractTodoLabels } from "@/src/domain/todos";

export const TODO_BATCH_MAX_ITEMS = 75;
export const TODO_BATCH_MAX_DEPTH = 8;
export const TODO_BATCH_MAX_INPUT_LENGTH = 12_000;
export const TODO_BATCH_MAX_TITLE_LENGTH = 240;
export const TODO_BATCH_MAX_LABELS = 12;

export type TodoBatchIssue = {
  line: number;
  code:
    | "input_too_long"
    | "missing_bullet"
    | "empty_title"
    | "title_too_long"
    | "indented_root"
    | "inconsistent_indent"
    | "depth_limit"
    | "item_limit"
    | "label_limit"
    | "duplicate_title";
  message: string;
};

export type ParsedTodoBatchItem = {
  /** Stable within one parse; callers replace it with a real draft id. */
  key: string;
  line: number;
  title: string;
  depth: number;
  parentKey?: string;
  labels: string[];
};

export type ParsedTodoBatch = {
  items: ParsedTodoBatchItem[];
  errors: TodoBatchIssue[];
  warnings: TodoBatchIssue[];
  ignoredBlankLines: number;
};

// Markdown, common Notes-app glyphs, numbered lists, and task-list checkboxes.
const BULLET_PATTERN =
  /^(?:[-*+\u2022\u25e6\u25aa\u2023\u2013\u2014]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s*)?(.*?)\s*$/u;

function indentationColumns(value: string) {
  // Tabs are a logical indentation step. Spaces remain exact so mixed or
  // accidental half-dedents can be reported instead of silently reparenting.
  let columns = 0;
  for (const character of value) columns += character === "\t" ? 4 : 1;
  return columns;
}

/**
 * Parse a pasted outline without guessing at data after malformed lines.
 * Any number of spaces can establish the first child level; later dedents
 * must return to an indentation level that has already appeared.
 */
export function parseTodoBatch(input: string): ParsedTodoBatch {
  const errors: TodoBatchIssue[] = [];
  const warnings: TodoBatchIssue[] = [];
  const items: ParsedTodoBatchItem[] = [];
  let ignoredBlankLines = 0;

  if (input.length > TODO_BATCH_MAX_INPUT_LENGTH) {
    errors.push({
      line: 1,
      code: "input_too_long",
      message: `Keep the outline under ${TODO_BATCH_MAX_INPUT_LENGTH.toLocaleString()} characters.`,
    });
  }

  // One most-recent node per depth. A child always attaches to the nearest
  // preceding shallower item, matching Markdown and native Notes editors.
  const indentByDepth: number[] = [0];
  const nodeKeyByDepth: string[] = [];
  let previousIndent = 0;
  let previousDepth = 0;

  input
    .slice(0, TODO_BATCH_MAX_INPUT_LENGTH)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((rawLine, index) => {
      const line = index + 1;
      if (!rawLine.trim()) {
        ignoredBlankLines += 1;
        return;
      }
      if (items.length >= TODO_BATCH_MAX_ITEMS) {
        if (!errors.some((issue) => issue.code === "item_limit"))
          errors.push({
            line,
            code: "item_limit",
            message: `Import at most ${TODO_BATCH_MAX_ITEMS} to-dos at once.`,
          });
        return;
      }

      const leading = rawLine.match(/^[\t ]*/)?.[0] ?? "";
      const indentation = indentationColumns(leading);
      const content = rawLine.slice(leading.length);
      const bullet = content.match(BULLET_PATTERN);
      if (!bullet) {
        errors.push({
          line,
          code: "missing_bullet",
          message: "Start each to-do with -, *, •, or a number such as 1.",
        });
        return;
      }
      const title = (bullet[1] ?? "").trim();
      if (!title) {
        errors.push({ line, code: "empty_title", message: "Add text after the bullet." });
        return;
      }
      if (title.length > TODO_BATCH_MAX_TITLE_LENGTH) {
        errors.push({
          line,
          code: "title_too_long",
          message: `A to-do title can contain at most ${TODO_BATCH_MAX_TITLE_LENGTH} characters.`,
        });
        return;
      }

      let depth = 0;
      if (!items.length && indentation > 0) {
        errors.push({
          line,
          code: "indented_root",
          message: "The first to-do must start at the left edge.",
        });
        return;
      }
      if (items.length) {
        if (indentation > previousIndent) {
          depth = previousDepth + 1;
          indentByDepth[depth] = indentation;
          indentByDepth.length = depth + 1;
        } else {
          depth = indentByDepth.findIndex((known) => known === indentation);
          if (depth < 0 || depth > previousDepth) {
            errors.push({
              line,
              code: "inconsistent_indent",
              message: "Align this bullet with an earlier level, or indent it beneath the previous item.",
            });
            return;
          }
          indentByDepth.length = depth + 1;
        }
      }
      if (depth > TODO_BATCH_MAX_DEPTH) {
        errors.push({
          line,
          code: "depth_limit",
          message: `Use at most ${TODO_BATCH_MAX_DEPTH} nested levels.`,
        });
        return;
      }

      const labels = extractTodoLabels(title);
      if (labels.length >= TODO_BATCH_MAX_LABELS) {
        // extractTodoLabels intentionally caps output, so count the raw unique
        // tokens to distinguish exactly 12 valid labels from overflow.
        const rawLabels = new Set(
          [...title.matchAll(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu)].map(
            (match) => (match[2] ?? "").toLocaleLowerCase(),
          ),
        );
        if (rawLabels.size > TODO_BATCH_MAX_LABELS) {
          errors.push({
            line,
            code: "label_limit",
            message: `Use at most ${TODO_BATCH_MAX_LABELS} unique #labels on one to-do.`,
          });
          return;
        }
      }

      const key = `line-${line}`;
      const parentKey = depth > 0 ? nodeKeyByDepth[depth - 1] : undefined;
      if (depth > 0 && !parentKey) {
        errors.push({
          line,
          code: "inconsistent_indent",
          message: "Add a parent item before this nested to-do.",
        });
        return;
      }
      items.push({ key, line, title, depth, parentKey, labels });
      nodeKeyByDepth[depth] = key;
      nodeKeyByDepth.length = depth + 1;
      previousIndent = indentation;
      previousDepth = depth;
    });

  const duplicateLines = new Map<string, number>();
  for (const item of items) {
    const normalized = item.title.normalize("NFKC").trim().toLocaleLowerCase();
    const firstLine = duplicateLines.get(normalized);
    if (firstLine !== undefined)
      warnings.push({
        line: item.line,
        code: "duplicate_title",
        message: `Same title as line ${firstLine}; both will be created.`,
      });
    else duplicateLines.set(normalized, item.line);
  }

  return { items, errors, warnings, ignoredBlankLines };
}
