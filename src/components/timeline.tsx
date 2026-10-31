import { cn } from "@/lib/utils";

/** A vertical list of events joined by a line. Items are given newest first. */
export function Timeline({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol className={cn("flex flex-col", className)} {...props} />;
}

/**
 * One event. `highlighted` marks the latest event (filled dot). The connecting line is drawn from
 * each dot down to the next item, and hidden on the last one.
 */
export function TimelineItem({
  highlighted = false,
  className,
  children,
  ...props
}: React.ComponentProps<"li"> & { highlighted?: boolean }) {
  return (
    <li
      className={cn(
        "relative pb-6 pl-7 last:pb-0",
        "before:absolute before:top-5 before:bottom-0 before:left-[5px] before:w-px before:bg-border last:before:hidden",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 left-0 size-3 rounded-full border-2",
          highlighted ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background",
        )}
      />
      {children}
    </li>
  );
}
