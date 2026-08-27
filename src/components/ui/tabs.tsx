/**
 * shadcn/ui tabs, copied into the repo (SPEC §7) over the Radix primitive.
 *
 * Radix owns the part that is genuinely hard: roving focus with arrow keys,
 * Home/End, the `tablist` / `tab` / `tabpanel` roles, and the `aria-labelledby`
 * that names each panel by its trigger. `@radix-ui/react-*` is pre-approved
 * for exactly this (`docs/agents/dependencies.md`).
 *
 * Styling stays inside the design system (ticket 33): tokens from `App.css`,
 * no new per-component scale.
 *
 * The selected tab is filled with the app's action green, the same green as
 * the fold control beside it and as `Open Archer's Hub` and `Add to Plan`.
 * ADR-0012 gives the hue channel to course identity, but it is scoped to the
 * *grid's blocks* — the four attributes it arbitrates between are all section
 * properties. Chrome above the grid is not competing for that channel. What
 * the rule does still demand is that a tab never read as data, so the fill is
 * flat and saturated where a block's tint is pale: nobody will mistake this
 * row for a course.
 */

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex w-full items-center gap-1 rounded-panel border border-border bg-muted p-1",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // No transition: this row sits above a working surface, and the tab
      // that is selected has to be readable the instant it changes.
      "inline-flex flex-1 items-center justify-center gap-1.5 rounded-card px-3 py-2",
      "text-xs font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-flat",
      "hover:text-foreground data-[state=active]:hover:text-white",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
