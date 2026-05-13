import { describe, expect, it } from "vitest";
import { getFileTreeIndent } from "./fileTree";

describe("getFileTreeIndent", () => {
  it("uses the same base indent for top-level files and folders", () => {
    expect(getFileTreeIndent(0)).toBe("0.4rem");
  });

  it("increments indentation by a stable step per depth level", () => {
    expect(getFileTreeIndent(1)).toBe("1.3rem");
    expect(getFileTreeIndent(2)).toBe("2.2rem");
  });
});
