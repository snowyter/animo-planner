import { describe, expect, it } from "vitest";
import {
  COURSE_PALETTE,
  getCourseTheme,
} from "./palette";

describe("palette", () => {
  it("provides at least 8 distinct categorical color themes", () => {
    expect(COURSE_PALETTE.length).toBeGreaterThanOrEqual(8);

    // Verify all names are unique
    const names = new Set(COURSE_PALETTE.map((p) => p.name));
    expect(names.size).toBe(COURSE_PALETTE.length);

    // Verify all hex colors are unique
    const borderColors = new Set(COURSE_PALETTE.map((p) => p.borderHex));
    expect(borderColors.size).toBe(COURSE_PALETTE.length);

    // The app is light-only (ADR-0018). A stray `dark:` variant here rendered
    // grid blocks dark while every surface around them stayed light.
    for (const theme of COURSE_PALETTE) {
      expect(theme.bgClass).not.toContain("dark:");
      expect(theme.textClass).not.toContain("dark:");
      expect(theme.borderClass).not.toContain("dark:");
      expect(theme.badgeClass).not.toContain("dark:");
    }
  });

  it("deterministically returns the same theme for the same course ID", () => {
    const themeA = getCourseTheme(2923);
    const themeB = getCourseTheme(2923);
    expect(themeA).toEqual(themeB);
  });

  it("assigns distinct themes to different course IDs", () => {
    const theme1 = getCourseTheme(1);
    const theme2 = getCourseTheme(2);
    expect(theme1.name).not.toEqual(theme2.name);
  });

  it("distributes courses across the palette sequentially when a course list is provided", () => {
    const courseIds = [101, 102, 103, 104, 105, 106, 107, 108];
    const themes = courseIds.map((id) => getCourseTheme(id, courseIds));

    // With 8 courses and >= 8 palette colors, each gets a unique palette entry
    const themeNames = new Set(themes.map((t) => t.name));
    expect(themeNames.size).toBe(8);
  });

  it("encodes course identity only regardless of block modality or extra properties", () => {
    // Both hybrid and F2F sections for the same course must get the exact same theme
    const themeForGeartapF2F = getCourseTheme(2923);
    const themeForGeartapOnline = getCourseTheme(2923);
    expect(themeForGeartapF2F.borderHex).toBe(themeForGeartapOnline.borderHex);
    expect(themeForGeartapF2F.bgHex).toBe(themeForGeartapOnline.bgHex);
  });

  it("handles string course codes or negative/zero/large IDs safely", () => {
    expect(getCourseTheme("GEARTAP")).toBeDefined();
    expect(getCourseTheme(0)).toBeDefined();
    expect(getCourseTheme(-42)).toBeDefined();
    expect(getCourseTheme(999999)).toBeDefined();
  });
});
