import { useState, useCallback, type Dispatch, type SetStateAction } from "react";

/**
 * Manages an array of items with upsert-by-key semantics.
 *
 * Given a new item, either replaces the existing item whose `key` field
 * matches, or appends it to the array.
 *
 * @param initial  Starting array (default `[]`)
 * @param key      Field name used to identify items (default `"id"`)
 * @returns        `[items, upsertItem, setItems]`
 */
export default function useUpsert<T extends { [K in keyof T]: T[K] }>(
  initial: T[] = [],
  key: keyof T & string = "id" as keyof T & string,
): [T[], (item: T) => void, Dispatch<SetStateAction<T[]>>] {
  const [items, setItems] = useState<T[]>(initial);

  const upsertItem = useCallback(
    (item: T) => {
      setItems((prev) => {
        const idx = prev.findIndex((p) => p[key] === item[key]);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = item;
          return next;
        }
        return [...prev, item];
      });
    },
    [key],
  );

  return [items, upsertItem, setItems];
}
