import { describe, expect, it } from "vitest";
import { resolveManagedAttachmentOpenPath } from "./attachmentPaths";

describe("resolveManagedAttachmentOpenPath", () => {
  it("prefers the freshly resolved absolute path", () => {
    expect(
      resolveManagedAttachmentOpenPath(
        "C:\\Users\\cy\\Documents\\Infinite Canvas\\Documents\\doc.attachments\\paper.pdf",
        "C:\\cached\\paper.pdf",
      ),
    ).toBe("C:\\Users\\cy\\Documents\\Infinite Canvas\\Documents\\doc.attachments\\paper.pdf");
  });

  it("falls back to cached path when resolution returns nothing", () => {
    expect(
      resolveManagedAttachmentOpenPath(
        null,
        "C:\\Users\\cy\\Documents\\Infinite Canvas\\Documents\\doc.attachments\\paper.pdf",
      ),
    ).toBe("C:\\Users\\cy\\Documents\\Infinite Canvas\\Documents\\doc.attachments\\paper.pdf");
  });

  it("returns null when neither path is available", () => {
    expect(resolveManagedAttachmentOpenPath(null, "")).toBeNull();
  });
});
