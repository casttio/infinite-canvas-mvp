import type { ViewState } from "../model/types";

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const ZOOM_STEP_FACTOR = 1.08;
export const MAX_ZOOM_SLIDER_VALUE = Math.round(Math.log(MAX_ZOOM / MIN_ZOOM) / Math.log(ZOOM_STEP_FACTOR));

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const stepZoom = (zoom: number, direction: "in" | "out") =>
  clampZoom(zoom * (direction === "in" ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR));

export const zoomToSliderValue = (zoom: number) =>
  Math.round(Math.log(clampZoom(zoom) / MIN_ZOOM) / Math.log(ZOOM_STEP_FACTOR));

export const sliderValueToZoom = (value: number) =>
  clampZoom(MIN_ZOOM * ZOOM_STEP_FACTOR ** value);

export const zoomAtPoint = (
  viewState: ViewState,
  screenX: number,
  screenY: number,
  containerRect: DOMRect,
  nextZoom: number,
): ViewState => {
  const zoom = clampZoom(nextZoom);
  const originX = screenX - containerRect.left;
  const originY = screenY - containerRect.top;
  const worldX = (originX - viewState.cameraX) / viewState.zoom;
  const worldY = (originY - viewState.cameraY) / viewState.zoom;

  return {
    ...viewState,
    zoom,
    cameraX: originX - worldX * zoom,
    cameraY: originY - worldY * zoom,
  };
};

export const toWorldPoint = (
  clientX: number,
  clientY: number,
  rect: DOMRect,
  viewState: ViewState,
) => ({
  x: (clientX - rect.left - viewState.cameraX) / viewState.zoom,
  y: (clientY - rect.top - viewState.cameraY) / viewState.zoom,
});
