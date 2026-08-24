/**
 * Pure domain logic and constants for the onboarding tour.
 * Free of I/O, DOM, and framework imports.
 */

export const DISCLAIMER_TEXT =
  "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials.";

export const SIGN_IN_NOTICE =
  "You will sign in directly on De La Salle University's Archer's Hub portal. Animo Plan never stores your credentials.";

export const ONBOARDING_STORAGE_KEY = "animo-plan:onboarding-completed";

export type OnboardingStep = "choice" | "pick-scope" | "sign-in" | "search-course";

const STEP_ORDER: OnboardingStep[] = [
  "choice",
  "pick-scope",
  "sign-in",
  "search-course",
];

export interface MinimalStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function isOnboardingCompleted(storage?: MinimalStorage): boolean {
  if (!storage) {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
    }
    if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: MinimalStorage }).localStorage) {
      return (globalThis as unknown as { localStorage: MinimalStorage }).localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
    }
    return false;
  }
  return storage.getItem(ONBOARDING_STORAGE_KEY) === "true";
}

export function setOnboardingCompleted(storage?: MinimalStorage): void {
  if (!storage) {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      return;
    }
    if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: MinimalStorage }).localStorage) {
      (globalThis as unknown as { localStorage: MinimalStorage }).localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
      return;
    }
    return;
  }
  storage.setItem(ONBOARDING_STORAGE_KEY, "true");
}

export function getNextOnboardingStep(current: OnboardingStep): OnboardingStep | null {
  const index = STEP_ORDER.indexOf(current);
  if (index === -1 || index >= STEP_ORDER.length - 1) {
    return null;
  }
  return STEP_ORDER[index + 1];
}

export function getPreviousOnboardingStep(current: OnboardingStep): OnboardingStep | null {
  const index = STEP_ORDER.indexOf(current);
  if (index <= 0) {
    return null;
  }
  return STEP_ORDER[index - 1];
}
