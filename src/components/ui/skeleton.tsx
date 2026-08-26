import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * A placeholder in the shape of the content that is coming.
 *
 * Skeletons replace spinners wherever that shape is known, which in this app
 * means the section list and the week grid. The breathe is `opacity` only, so
 * it stays on the compositor, and it exists only while something is loading —
 * an idle Animo Plan has no continuously animating elements at all.
 */
const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} aria-hidden="true" className={cn("skeleton", className)} {...props} />
));
Skeleton.displayName = "Skeleton";

export { Skeleton };
