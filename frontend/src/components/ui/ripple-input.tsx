import * as React from "react";
import { cn } from "@/lib/utils";

const RippleInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const [ripple, setRipple] = React.useState<{ active: boolean; x: number; y: number }>({
      active: false,
      x: 0,
      y: 0,
    });
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inputRef.current!);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      const rect = e.currentTarget.getBoundingClientRect();
      setRipple({
        active: true,
        x: rect.width / 2,
        y: rect.height / 2,
      });
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      setRipple((prev) => ({ ...prev, active: false }));
      props.onBlur?.(e);
    };

    return (
      <div className="relative">
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm transition-all duration-300",
            isFocused && "border-transparent rgb-input-focus",
            className,
          )}
          ref={inputRef}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        {/* Focus glow effect */}
        <div
          className={cn(
            "absolute inset-0 rounded-md pointer-events-none transition-opacity duration-300",
            ripple.active ? "opacity-100" : "opacity-0"
          )}
          style={{
            background: `radial-gradient(circle at ${ripple.x}px ${ripple.y}px, rgb(var(--rgb-cyan) / 0.15) 0%, transparent 70%)`,
          }}
        />
        {/* Border glow */}
        <div
          className={cn(
            "absolute inset-0 rounded-md pointer-events-none transition-all duration-500",
            isFocused ? "input-glow-active" : "opacity-0"
          )}
        />
      </div>
    );
  },
);
RippleInput.displayName = "RippleInput";

export { RippleInput };
