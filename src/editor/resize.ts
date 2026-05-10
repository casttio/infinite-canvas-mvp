const MIN_SIZE = 80;

export type ResizeHandle = "bottom-right" | "left" | "right";

export const resizeNode = (
  start: { x: number; w: number; h: number },
  delta: { x: number; y: number },
  mode: "free" | "width-only" = "free",
  handle: ResizeHandle = "bottom-right",
  minX = Number.NEGATIVE_INFINITY,
) => ({
  ...(() => {
    if (handle === "left") {
      const maxX = start.x + start.w - MIN_SIZE;
      const x = Math.min(maxX, Math.max(minX, start.x + delta.x));

      return {
        x,
        w: start.w + (start.x - x),
        h: start.h,
      };
    }

    return {
      x: start.x,
      w: Math.max(MIN_SIZE, start.w + delta.x),
      h: handle === "right" || mode === "width-only" ? start.h : Math.max(MIN_SIZE, start.h + delta.y),
    };
  })(),
});
