/**
 * Categorical color palette for course identity in schedule views.
 *
 * ADR-0012: Hue encodes course identity only, never modality.
 * Modality gets a left-border style plus an icon, enrolment gets a numeric
 * label, and pinned-versus-tentative gets border weight / opacity.
 *
 * Palette must stay categorical, accessible, and distinguishable at eight or
 * more courses in both light and dark themes.
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
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
    borderClass: "border-emerald-600 dark:border-emerald-500",
    textClass: "text-emerald-900 dark:text-emerald-100",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
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
    bgClass: "bg-indigo-50 dark:bg-indigo-950/40",
    borderClass: "border-indigo-600 dark:border-indigo-500",
    textClass: "text-indigo-900 dark:text-indigo-100",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
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
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
    borderClass: "border-amber-600 dark:border-amber-500",
    textClass: "text-amber-900 dark:text-amber-100",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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
    bgClass: "bg-rose-50 dark:bg-rose-950/40",
    borderClass: "border-rose-600 dark:border-rose-500",
    textClass: "text-rose-900 dark:text-rose-100",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
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
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
    borderClass: "border-sky-600 dark:border-sky-500",
    textClass: "text-sky-900 dark:text-sky-100",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
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
    bgClass: "bg-violet-50 dark:bg-violet-950/40",
    borderClass: "border-violet-600 dark:border-violet-500",
    textClass: "text-violet-900 dark:text-violet-100",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
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
    bgClass: "bg-teal-50 dark:bg-teal-950/40",
    borderClass: "border-teal-600 dark:border-teal-500",
    textClass: "text-teal-900 dark:text-teal-100",
    badgeClass: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
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
    bgClass: "bg-fuchsia-50 dark:bg-fuchsia-950/40",
    borderClass: "border-fuchsia-600 dark:border-fuchsia-500",
    textClass: "text-fuchsia-900 dark:text-fuchsia-100",
    badgeClass: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200",
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
    bgClass: "bg-slate-100 dark:bg-slate-800/40",
    borderClass: "border-slate-600 dark:border-slate-500",
    textClass: "text-slate-900 dark:text-slate-100",
    badgeClass: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
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
    bgClass: "bg-lime-50 dark:bg-lime-950/40",
    borderClass: "border-lime-600 dark:border-lime-500",
    textClass: "text-lime-900 dark:text-lime-100",
    badgeClass: "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200",
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
