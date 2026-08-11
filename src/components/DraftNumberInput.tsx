import React, { useEffect, useRef, useState } from "react";
import { TextInputProps } from "react-native";

import { AppTextInput } from "@/src/components/AppText";

type RequiredDraftNumberInputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  value: number;
  onCommit: (value: number) => void;
  minimum?: number;
  maximum?: number;
  /** Refresh dependent calculations while a complete numeric draft is typed. */
  commitOnChange?: boolean;
  allowEmpty?: false;
};

type OptionalDraftNumberInputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  minimum?: number;
  maximum?: number;
  /** Refresh dependent calculations while a complete numeric draft is typed. */
  commitOnChange?: boolean;
  /** An empty draft commits `undefined`, used for genuinely optional measurements. */
  allowEmpty: true;
};

export function DraftNumberInput(props: RequiredDraftNumberInputProps): React.JSX.Element;
export function DraftNumberInput(props: OptionalDraftNumberInputProps): React.JSX.Element;
export function DraftNumberInput({
  value,
  onCommit,
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY,
  commitOnChange = false,
  allowEmpty = false,
  ...props
}: RequiredDraftNumberInputProps | OptionalDraftNumberInputProps) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current)
      setDraft(value === undefined ? "" : String(value));
  }, [value]);

  function emit(next: number | undefined) {
    if (allowEmpty)
      (onCommit as OptionalDraftNumberInputProps["onCommit"])(next);
    else if (next !== undefined)
      (onCommit as RequiredDraftNumberInputProps["onCommit"])(next);
  }

  function commit() {
    focused.current = false;
    if (allowEmpty && draft.trim() === "") {
      if (value !== undefined) emit(undefined);
      return;
    }
    const parsed = Number(draft.replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      const next = Math.min(maximum, Math.max(minimum, parsed));
      setDraft(String(next));
      emit(next);
    } else setDraft(value === undefined ? "" : String(value));
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
          emit(parsed);
      }}
      onBlur={(event) => {
        commit();
        props.onBlur?.(event);
      }}
    />
  );
}
