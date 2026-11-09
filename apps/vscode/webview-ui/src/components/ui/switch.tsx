import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
  variant?: "default" | "blue";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // base — p-[2px] gives the thumb an even optical inset on all four
        // sides. The previous geometry (18.4px track, 16px thumb) left ~0.6px
        // above and below but 2px at the travel end, so it read as a blob
        // rather than a track.
        "data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive shrink-0 rounded-full border border-transparent p-[2px] focus-visible:ring-[3px] aria-invalid:ring-[3px] data-[size=default]:h-[18px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] peer group/switch relative inline-flex items-center transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",

        // variants — the "on" track has to light up against the "off" track.
        // `bg-primary` maps to the editor's button color, which some themes
        // render darker than the unchecked `--input` track, so the on state
        // uses the success/brand accents instead.
        variant === "default" && "data-checked:bg-success",
        variant === "blue" && "data-checked:bg-brand",

        className,
      )}
      {...props}
    >
      {/* Travel is the track's content box minus the thumb: 32 - 2(border) - 4(padding)
          - 14(thumb) = 12px, and 24 - 2 - 4 - 10 = 8px for the small size. Larger
          offsets push the thumb off its inset and leave the two ends uneven.
          The checked thumb uses --success-foreground rather than white: on the dark
          theme's lighter green, white sits near 2:1, under the 3:1 that WCAG 1.4.11
          asks of a control that signals state by colour. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="data-unchecked:bg-foreground data-checked:bg-success-foreground rounded-full group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-[12px] group-data-[size=sm]/switch:data-checked:translate-x-[8px] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 pointer-events-none block ring-0 transition-transform"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
