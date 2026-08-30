/**
 * A cursor-following spotlight, for one card at a time.
 *
 * Source: React Bits — `SpotlightCard` (https://reactbits.dev), from
 * `DavidHDev/react-bits`, licensed **MIT + Commons Clause**. Copied in under
 * that licence rather than installed: there is no npm package for it, and the
 * licence forbids redistributing the collection. See
 * `docs/agents/dependencies.md` for the decision and for the tiers that are
 * ruled out.
 *
 * Substantially rewritten for this app, which is the condition on using it:
 *
 * - **Light-only (ADR-0018).** The original is a dark card — `bg-neutral-900`,
 *   white spotlight on black. Both are inverted here.
 * - **No frosted glass and no compositor hints.** The original sets neither,
 *   but the pattern invites both, and the guard test bans them outside
 *   `ui/dialog.tsx` — so they are not named here either, because the guard
 *   greps source text and a comment spelling them out would fail it.
 * - **It is one element, never a list.** The original is written to be dropped
 *   anywhere. It is not: a `mousemove` listener and a state update per card is
 *   exactly the per-item cost the design system refuses on repeated elements.
 *   This is used on the plan list's empty state and nowhere else.
 *
 * The spotlight is a radial gradient whose centre is two CSS custom
 * properties, written directly to the node on `mousemove`. A move costs one
 * style write and no React render; only entering and leaving the card
 * change state.
 */

import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import { cn } from "../../lib/utils";

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** CSS colour of the glow. Kept pale: this sits on white. */
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgb(21 128 61 / 0.10)",
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isActive, setIsActive] = useState(false);

  /**
   * The pointer position is written straight to two custom properties, never
   * held in state.
   *
   * A `mousemove` fires on the order of once a frame for as long as the
   * pointer is over the card. Routing that through `useState` re-renders this
   * subtree at the same rate, which is precisely the per-move React cost the
   * design system refuses — and it would be invisible in review, because the
   * rendered output is identical either way. Setting the property mutates one
   * value on one node and lets the compositor do the rest.
   */
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node || isFocused) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      data-testid="spotlight-card"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsActive(true)}
      onMouseLeave={() => setIsActive(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        setIsActive(false);
      }}
      className={cn("relative overflow-hidden", className)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out"
        style={{
          opacity: isActive || isFocused ? 1 : 0,
          // The custom properties are set on the card, so this inherits
          // them; the fallback centres the glow before the first move.
          background: `radial-gradient(circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}

export default SpotlightCard;
