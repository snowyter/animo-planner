import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  // The press.
  //
  // Every action in this app is a button, and one that gives no feedback
  // leaves the student unsure whether the click landed — during enlistment,
  // that is a double-click on "Add to Plan". `scale` rather than a colour
  // shift because it is compositor-only: no paint, no layout, and it cannot
  // cost frames on a surface holding forty other controls.
  //
  // The transition names its properties explicitly — `transform`,
  // `box-shadow`, and the `color`/`background-color` the hover fills need —
  // and never `transition-all`, which on the app's most repeated control is
  // one stray property away from animating layout.
  //
  // It sits on the base, so every variant inherits it and a new variant
  // cannot quietly become the one control that does not respond.
  //
  // Focus is never invisible: `:focus-visible` in App.css draws the ring for
  // every interactive element, and this keeps it from being suppressed here.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium cursor-pointer active:scale-[0.97] transition-[transform,box-shadow,color,background-color,border-color] duration-150 ease-out disabled:active:scale-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-flat hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground shadow-flat hover:bg-red-700",
        outline:
          "border border-border bg-card text-foreground shadow-flat hover:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-slate-200",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-control px-3 text-xs",
        lg: "h-10 rounded-control px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
