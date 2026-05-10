import { describe, it, expect } from "vitest";
import {
  clampZoom,
  stepZoom,
  zoomToSliderValue,
  sliderValueToZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP_FACTOR,
} from "./viewport";

describe("clampZoom", () => {
  it("returns value within [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.2)).toBe(0.2);
    expect(clampZoom(3)).toBe(3);
  });
});

describe("stepZoom", () => {
  it("zooms in by ZOOM_STEP_FACTOR", () => {
    const r = stepZoom(1, "in");
    expect(r).toBeCloseTo(1 * ZOOM_STEP_FACTOR, 6);
  });

  it("zooms out by 1/ZOOM_STEP_FACTOR", () => {
    const r = stepZoom(1, "out");
    expect(r).toBeCloseTo(1 / ZOOM_STEP_FACTOR, 6);
  });

  it("never goes below MIN_ZOOM", () => {
    const r = stepZoom(MIN_ZOOM, "out");
    expect(r).toBe(MIN_ZOOM);
  });

  it("never goes above MAX_ZOOM", () => {
    const r = stepZoom(MAX_ZOOM, "in");
    expect(r).toBe(MAX_ZOOM);
  });
});

describe("zoomToSliderValue / sliderValueToZoom", () => {
  it("round-trips correctly", () => {
    const values = [0.3, 0.5, 1, 2, 2.5];
    for (const v of values) {
      const slider = zoomToSliderValue(v);
      const back = sliderValueToZoom(slider);
      expect(back).toBeCloseTo(v, 1);
    }
  });

  it("sliderValueToZoom(0) equals MIN_ZOOM", () => {
    expect(sliderValueToZoom(0)).toBe(MIN_ZOOM);
  });

  it("zoomToSliderValue clamps input first", () => {
    expect(zoomToSliderValue(999)).toBe(zoomToSliderValue(MAX_ZOOM));
    expect(zoomToSliderValue(0.01)).toBe(zoomToSliderValue(MIN_ZOOM));
  });
});
