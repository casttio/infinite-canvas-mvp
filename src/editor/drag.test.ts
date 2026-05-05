import { describe, it, expect } from "vitest";
import { dragNode } from "./drag";

describe("dragNode", () => {
  it("applies delta to start position", () => {
    const r = dragNode({ x: 100, y: 200 }, { x: 50, y: -30 });
    expect(r).toEqual({ x: 150, y: 170 });
  });

  it("zero delta returns start", () => {
    const r = dragNode({ x: 42, y: 99 }, { x: 0, y: 0 });
    expect(r).toEqual({ x: 42, y: 99 });
  });

  it("negative delta moves left and up", () => {
    const r = dragNode({ x: 50, y: 50 }, { x: -10, y: -20 });
    expect(r).toEqual({ x: 40, y: 30 });
  });
});
