export const dragNode = (
  start: { x: number; y: number },
  delta: { x: number; y: number },
) => ({
  x: start.x + delta.x,
  y: start.y + delta.y,
});
