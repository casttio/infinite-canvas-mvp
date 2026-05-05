import { describe, it, expect } from "vitest";
import { resizeNode } from "./resize";

describe("resizeNode", () => {
  it("bottom-right handle: increases width and height with positive delta (clamped to MIN_SIZE)", () => {
    const r = resizeNode({ x: 10, w: 100, h: 50 }, { x: 20, y: 10 });
    // w: 100+20=120, h: 50+10=60 < 80 → clamped to 80
    expect(r).toEqual({ x: 10, w: 120, h: 80 });
  });

  it("bottom-right handle: large enough start to allow free resize", () => {
    const r = resizeNode({ x: 10, w: 200, h: 200 }, { x: 20, y: 10 });
    expect(r).toEqual({ x: 10, w: 220, h: 210 });
  });

  it("bottom-right handle: does not go below MIN_SIZE (80)", () => {
    const r = resizeNode({ x: 10, w: 100, h: 50 }, { x: -90, y: -90 });
    expect(r.w).toBe(80);
    expect(r.h).toBe(80);
    expect(r.x).toBe(10);
  });

  it("bottom-right handle: negative x delta reduces width (clamped to MIN_SIZE)", () => {
    const r = resizeNode({ x: 10, w: 100, h: 50 }, { x: -30, y: 0 });
    // w: 100-30=70 < 80 → clamped to 80, h: 50+0=50 < 80 → clamped to 80
    expect(r).toEqual({ x: 10, w: 80, h: 80 });
  });

  it("left handle: moves x and reduces width", () => {
    const r = resizeNode({ x: 100, w: 200, h: 80 }, { x: 30, y: 0 }, "free", "left");
    expect(r.x).toBe(130);
    expect(r.w).toBe(170);
    expect(r.h).toBe(80);
  });

  it("left handle: left drag increases width, x decreases", () => {
    const r = resizeNode({ x: 100, w: 200, h: 80 }, { x: -40, y: 0 }, "free", "left");
    expect(r.x).toBe(60);
    expect(r.w).toBe(240);
    expect(r.h).toBe(80);
  });

  it("left handle: clamps to minX when provided", () => {
    const r = resizeNode({ x: 100, w: 200, h: 80 }, { x: -999, y: 0 }, "free", "left", 50);
    expect(r.x).toBe(50);
    expect(r.w).toBe(250);
  });

  it("left handle: width never below MIN_SIZE", () => {
    const r = resizeNode({ x: 100, w: 100, h: 80 }, { x: 95, y: 0 }, "free", "left");
    expect(r.w).toBe(80);
    expect(r.x).toBe(120); // 100 + (100 - 80)
  });

  it("right handle: changes width only", () => {
    const r = resizeNode({ x: 0, w: 200, h: 100 }, { x: 50, y: 30 }, "free", "right");
    expect(r.w).toBe(250);
    expect(r.h).toBe(100);
    expect(r.x).toBe(0);
  });

  it("right handle: width never below MIN_SIZE", () => {
    const r = resizeNode({ x: 0, w: 100, h: 100 }, { x: -200, y: 0 }, "free", "right");
    expect(r.w).toBe(80);
    expect(r.x).toBe(0);
  });

  it("width-only mode: only width changes, height stays", () => {
    const r = resizeNode({ x: 0, w: 100, h: 100 }, { x: 30, y: 50 }, "width-only");
    expect(r.w).toBe(130);
    expect(r.h).toBe(100);
  });

  it("width-only mode with left handle: width changes, height stays", () => {
    const r = resizeNode({ x: 100, w: 200, h: 100 }, { x: 50, y: 30 }, "width-only", "left");
    expect(r.x).toBe(150);
    expect(r.w).toBe(150);
    expect(r.h).toBe(100);
  });
});
