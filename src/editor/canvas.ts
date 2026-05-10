import { toWorldPoint } from "./viewport";

export const getCanvasCenterPoint = (
  rect: DOMRect,
  viewState: { cameraX: number; cameraY: number; zoom: number },
) =>
  toWorldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, viewState);
