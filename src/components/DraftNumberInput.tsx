import React, { useEffect, useRef, useState } from "react";
import { TextInputProps } from "react-native";

import { AppTextInput } from "@/src/components/AppText";

export function DraftNumberInput({
  value,
  onCommit,
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY,
  commitOnChange = false,
  ...props
}: Omit<TextInputProps, "value" | "onChangeText"> & {
  value: number;
  onCommit: (value: number) => void;
  minimum?: number;
  maximum?: number;
  /** Refresh dependent calculations while a complete numeric draft is typed. */
  commitOnChange?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  function commit() {
    focused.current = false;
    const parsed = Number(draft.replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      const next = Math.min(maximum, Math.max(minimum, parsed));
      setDraft(String(next));
      onCommit(next);
    } else setDraft(String(value));
  }

  return (
    <AppTextInput
      {...props}
      value={draft}
      onFocus={(event) => {
        focused.current = true;
        props.onFocus?.(event);
      }}
      onChangeText={(nextDraft) => {
        setDraft(nextDraft);
        if (!commitOnChange || nextDraft.trim() === "") return;
        const parsed = Number(nextDraft.replace(",", "."));
        if (
          Number.isFinite(parsed) &&
          parsed >= minimum &&
          parsed <= maximum
        )
          onCommit(parsed);
      }}
      onBlur={(event) => {
        commit();
        props.onBlur?.(event);
      }}
    />
  );
}
