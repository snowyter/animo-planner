/**
 * Categorical color palette for course identity in schedule views.
 *
 * ADR-0012: Hue encodes course identity only, never modality.
 * Modality gets a left-border style plus an icon, enrolment gets a numeric
 * label, and pinned-versus-tentative gets border weight / opacity.
 *
 * Palette must stay categorical, accessible, and distinguishable at eight or
 * more courses. The app is light-only (ADR-0018): these classes carry no
 * `dark:` variants, and `src/designSystem.test.ts` fails if one returns.
 */

export interface CourseTheme {
  id: string;
  name: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
  badgeBgHex: string;
  badgeTextHex: string;
  accentHex: string;
  // Tailwind class pairings for fast styling
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeClass: string;
}

export const COURSE_PALETTE: CourseTheme[] = [
  {
    id: "emerald",
    name: "Emerald",
    bgHex: "#ecfdf5",
    borderHex: "#059669",
    textHex: "#065f46",
    badgeBgHex: "#d1fae5",
    badgeTextHex: "#047857",
    accentHex: "#10b981",
    bgClass: "bg-emerald-50",
    borderClass: "border-emerald-600",
    textClass: "text-emerald-900",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  {
    id: "indigo",
    name: "Indigo",
    bgHex: "#eef2ff",
    borderHex: "#4f46e5",
    textHex: "#3730a3",
    badgeBgHex: "#e0e7ff",
    badgeTextHex: "#4338ca",
    accentHex: "#6366f1",
    bgClass: "bg-indigo-50",
    borderClass: "border-indigo-600",
    textClass: "text-indigo-900",
    badgeClass: "bg-indigo-100 text-indigo-800",
  },
  {
    id: "amber",
    name: "Amber",
    bgHex: "#fffbeb",
    borderHex: "#d97706",
    textHex: "#92400e",
    badgeBgHex: "#fef3c7",
    badgeTextHex: "#b45309",
    accentHex: "#f59e0b",
    bgClass: "bg-amber-50",
    borderClass: "border-amber-600",
    textClass: "text-amber-900",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  {
    id: "rose",
    name: "Rose",
    bgHex: "#fff1f2",
    borderHex: "#e11d48",
    textHex: "#9f1239",
    badgeBgHex: "#ffe4e6",
    badgeTextHex: "#be123c",
    accentHex: "#f43f5e",
    bgClass: "bg-rose-50",
    borderClass: "border-rose-600",
    textClass: "text-rose-900",
    badgeClass: "bg-rose-100 text-rose-800",
  },
  {
    id: "sky",
    name: "Sky",
    bgHex: "#f0f9ff",
    borderHex: "#0284c7",
    textHex: "#075985",
    badgeBgHex: "#e0f2fe",
    badgeTextHex: "#0369a1",
    accentHex: "#0ea5e9",
    bgClass: "bg-sky-50",
    borderClass: "border-sky-600",
    textClass: "text-sky-900",
    badgeClass: "bg-sky-100 text-sky-800",
  },
  {
    id: "violet",
    name: "Violet",
    bgHex: "#f5f3ff",
    borderHex: "#7c3aed",
    textHex: "#5b21b6",
    badgeBgHex: "#ede9fe",
    badgeTextHex: "#6d28d9",
    accentHex: "#8b5cf6",
    bgClass: "bg-violet-50",
    borderClass: "border-violet-600",
    textClass: "text-violet-900",
    badgeClass: "bg-violet-100 text-violet-800",
  },
  {
    id: "teal",
    name: "Teal",
    bgHex: "#f0fdfa",
    borderHex: "#0d9488",
    textHex: "#115e59",
    badgeBgHex: "#ccfbf1",
    badgeTextHex: "#0f766e",
    accentHex: "#14b8a6",
    bgClass: "bg-teal-50",
    borderClass: "border-teal-600",
    textClass: "text-teal-900",
    badgeClass: "bg-teal-100 text-teal-800",
  },
  {
    id: "fuchsia",
    name: "Fuchsia",
    bgHex: "#fdf4ff",
    borderHex: "#c026d3",
    textHex: "#86198f",
    badgeBgHex: "#fae8ff",
    badgeTextHex: "#a21caf",
    accentHex: "#d946ef",
    bgClass: "bg-fuchsia-50",
    borderClass: "border-fuchsia-600",
    textClass: "text-fuchsia-900",
    badgeClass: "bg-fuchsia-100 text-fuchsia-800",
  },
  {
    id: "slate",
    name: "Slate",
    bgHex: "#f8fafc",
    borderHex: "#475569",
    textHex: "#1e293b",
    badgeBgHex: "#e2e8f0",
    badgeTextHex: "#334155",
    accentHex: "#64748b",
    bgClass: "bg-slate-100",
    borderClass: "border-slate-600",
    textClass: "text-slate-900",
    badgeClass: "bg-slate-200 text-slate-800",
  },
  {
    id: "lime",
    name: "Lime",
    bgHex: "#f7fee7",
    borderHex: "#65a30d",
    textHex: "#3f6212",
    badgeBgHex: "#ecfccb",
    badgeTextHex: "#4d7c0f",
    accentHex: "#84cc16",
    bgClass: "bg-lime-50",
    borderClass: "border-lime-600",
    textClass: "text-lime-900",
    badgeClass: "bg-lime-100 text-lime-800",
  },
];

/**
 * Derives a consistent index into COURSE_PALETTE for a given course ID or code.
 */
export function getCourseColorIndex(
  courseIdentifier: number | string,
  allCourseIdentifiers?: (number | string)[]
): number {
  if (allCourseIdentifiers && allCourseIdentifiers.length > 0) {
    const idx = allCourseIdentifiers.indexOf(courseIdentifier);
    if (idx >= 0) {
      return idx % COURSE_PALETTE.length;
    }
  }

  if (typeof courseIdentifier === "number") {
    const absId = Math.abs(courseIdentifier);
    return absId % COURSE_PALETTE.length;
  }

  // Hash string
  let hash = 0;
  for (let i = 0; i < courseIdentifier.length; i++) {
    hash = (hash << 5) - hash + courseIdentifier.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % COURSE_PALETTE.length;
}

/**
 * Returns the categorical theme assigned to a course.
 */
export function getCourseTheme(
  courseIdentifier: number | string,
  allCourseIdentifiers?: (number | string)[]
): CourseTheme {
  const index = getCourseColorIndex(courseIdentifier, allCourseIdentifiers);
  return COURSE_PALETTE[index];
}
