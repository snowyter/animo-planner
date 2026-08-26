/**
 * shadcn/ui tabs, copied into the repo (SPEC §7) over the Radix primitive.
 *
 * Radix owns the part that is genuinely hard: roving focus with arrow keys,
 * Home/End, the `tablist` / `tab` / `tabpanel` roles, and the `aria-labelledby`
 * that names each panel by its trigger. `@radix-ui/react-*` is pre-approved
 * for exactly this (`docs/agents/dependencies.md`).
 *
 * Styling stays inside the design system (ticket 33): tokens from `App.css`,
 * no new per-component scale. A selected tab is chrome and is drawn in the
 * neutral palette — hue on this screen encodes course identity and nothing
 * else (ADR-0012).
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
      "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-flat",
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
