"use client";

import { useCallback, useSyncExternalStore } from "react";

export const STAFF_REVIEWER_STORAGE_KEY = "rar_staff_reviewer";
const LEGACY_SALE_REVIEWER_KEY = "rar-sale-reviewer";
const REVIEWER_CHANGED_EVENT = "rar:staff-reviewer-changed";

function readReviewer() {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem(STAFF_REVIEWER_STORAGE_KEY)
    ?? window.sessionStorage.getItem(STAFF_REVIEWER_STORAGE_KEY)
    ?? window.sessionStorage.getItem(LEGACY_SALE_REVIEWER_KEY)
    ?? ""
  );
}

function persistReviewer(value: string) {
  if (typeof window === "undefined") return;
  const clean = value.trim();
  if (clean) window.localStorage.setItem(STAFF_REVIEWER_STORAGE_KEY, value);
  else window.localStorage.removeItem(STAFF_REVIEWER_STORAGE_KEY);
  window.sessionStorage.removeItem(STAFF_REVIEWER_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_SALE_REVIEWER_KEY);
  window.dispatchEvent(new Event(REVIEWER_CHANGED_EVENT));
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STAFF_REVIEWER_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener(REVIEWER_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(REVIEWER_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** One reviewer identity shared by every staff workflow on this browser. */
export function useStaffReviewer() {
  const reviewer = useSyncExternalStore(subscribe, readReviewer, () => "");

  const setReviewer = useCallback((value: string) => {
    persistReviewer(value);
  }, []);

  return [reviewer, setReviewer] as const;
}
