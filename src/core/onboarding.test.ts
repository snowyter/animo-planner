import { describe, expect, it } from "vitest";
import {
  DISCLAIMER_TEXT,
  SIGN_IN_NOTICE,
  ONBOARDING_STORAGE_KEY,
  isOnboardingCompleted,
  setOnboardingCompleted,
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  type OnboardingStep,
} from "./onboarding";

describe("Onboarding core logic", () => {
  it("provides the verbatim disclaimer text", () => {
    expect(DISCLAIMER_TEXT).toBe(
      "Animo Plan is a student-built tool with no affiliation to, endorsement by, or connection with De La Salle University. It never enlists, never modifies your records, and never stores your credentials."
    );
  });

  it("provides the sign-in notice emphasizing university site and zero credential storage", () => {
    expect(SIGN_IN_NOTICE).toContain("Archer's Hub");
    expect(SIGN_IN_NOTICE).toContain("never stores your credentials");
  });

  it("reads onboarding completion status from storage", () => {
    const mockStorageEmpty = {
      getItem: () => null,
      setItem: () => {},
    };
    expect(isOnboardingCompleted(mockStorageEmpty)).toBe(false);

    const mockStorageCompleted = {
      getItem: (key: string) => (key === ONBOARDING_STORAGE_KEY ? "true" : null),
      setItem: () => {},
    };
    expect(isOnboardingCompleted(mockStorageCompleted)).toBe(true);
  });

  it("writes onboarding completion status to storage", () => {
    const store: Record<string, string> = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
    };

    expect(isOnboardingCompleted(mockStorage)).toBe(false);
    setOnboardingCompleted(mockStorage);
    expect(isOnboardingCompleted(mockStorage)).toBe(true);
    expect(store[ONBOARDING_STORAGE_KEY]).toBe("true");
  });

  it("transitions between onboarding steps correctly", () => {
    expect(getNextOnboardingStep("choice")).toBe("pick-scope");
    expect(getNextOnboardingStep("pick-scope")).toBe("sign-in");
    expect(getNextOnboardingStep("sign-in")).toBe("search-course");
    expect(getNextOnboardingStep("search-course")).toBe(null);

    expect(getPreviousOnboardingStep("search-course")).toBe("sign-in");
    expect(getPreviousOnboardingStep("sign-in")).toBe("pick-scope");
    expect(getPreviousOnboardingStep("pick-scope")).toBe("choice");
    expect(getPreviousOnboardingStep("choice")).toBe(null);

    expect(getNextOnboardingStep("invalid-step" as unknown as OnboardingStep)).toBe(null);
    expect(getPreviousOnboardingStep("invalid-step" as unknown as OnboardingStep)).toBe(null);
  });
});
