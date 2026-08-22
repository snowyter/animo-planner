/**
 * Core plan domain logic and utilities.
 */

export interface PlanScopeRef {
  campusId: number;
  sessionId: number;
}

export function formatPlanScope(campusName: string, sessionName: string): string {
  return `${campusName} • ${sessionName}`;
}

export function formatSectionCount(count: number): string {
  if (count === 1) {
    return "1 section";
  }
  return `${count} sections`;
}

export function isPlanScoped(plan: PlanScopeRef): boolean {
  return plan.campusId > 0 && plan.sessionId > 0;
}
