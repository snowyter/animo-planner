/**
 * The tool panel's tabs (ticket 46).
 *
 * The plan workspace is two regions: a tabbed tool panel and a permanent week
 * grid. The grid is deliberately not one of these tabs — it is the artifact
 * the app exists to produce, and the three tools act on it.
 *
 * The tab identities, their order, and the signal a trigger carries when the
 * catalog behind it is empty are decisions rather than markup, so they live
 * here where the triggers and the panels read the same copy of them.
 */

export type ToolTab = "capture" | "solve" | "pick";

export interface ToolTabInfo {
  tab: ToolTab;
  label: string;
  /** One line under the tab, naming what the tool does to the grid. */
  description: string;
}

/**
 * Capture → Solve → Pick, the order the work happens in. A student may use
 * them in any order; the ordering is a hint, not a workflow.
 */
export const TOOL_TABS: readonly ToolTabInfo[] = [
  {
    tab: "capture",
    label: "Capture",
    description: "What has landed from Archer's Hub, and how fresh it is.",
  },
  {
    tab: "solve",
    label: "Solve",
    description: "Ranked conflict-free combinations, previewed on the grid.",
  },
  {
    tab: "pick",
    label: "Pick",
    description: "Browse captured sections course by course.",
  },
] as const;

/** The arrival surface: nothing else works until something has been captured. */
export const DEFAULT_TOOL_TAB: ToolTab = "capture";

export function isToolTab(value: string): value is ToolTab {
  return TOOL_TABS.some((info) => info.tab === value);
}

/**
 * A tab id that cannot be honoured leaves the panel on the default rather
 * than rendering nothing — an empty tool panel beside the grid says less than
 * the wrong tool does.
 */
export function resolveToolTab(value: string | null | undefined): ToolTab {
  if (typeof value === "string" && isToolTab(value)) {
    return value;
  }
  return DEFAULT_TOOL_TAB;
}

/**
 * Tabs hide state, and that is the cost of this layout. The Capture trigger
 * carries a mark for as long as the catalog behind it is empty, so a student
 * on another tab can see where the hole is without switching.
 */
export function formatEmptyCatalogSignal(courseCount: number): string | null {
  return courseCount > 0 ? null : "Empty";
}

/** What an empty Pick tab says, naming the tab that fixes it. */
export function formatEmptyCatalogHint(): string {
  return "Nothing has been captured for this campus and term yet. Open the Capture tab, launch Archer's Hub, and search a course in Course Finder — its sections are captured silently as the results render.";
}
