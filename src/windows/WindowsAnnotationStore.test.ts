import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnnotationStore,
  TargetHashMismatchError,
  type TargetIdentity,
} from "./WindowsAnnotationStore.js";

describe("WindowsAnnotationStore", () => {
  let tempDir: string;
  let store: AnnotationStore;

  const target: TargetIdentity = {
    path: "C:\\fixtures\\sample.exe",
    sha256: "3333333333333333333333333333333333333333333333333333333333333333",
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rea-win-store-"));
    store = new AnnotationStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists function renames and comments to isolated storage", async () => {
    const fn = await store.annotateFunction(target, "0x140001000", {
      name: "MainEntry",
      comment: "Primary entry point on Windows PE",
    });

    expect(fn.name).toBe("MainEntry");
    expect(fn.comment).toBe("Primary entry point on Windows PE");

    const loaded = await store.load(target);
    expect(loaded?.functions["0x140001000"]?.name).toBe("MainEntry");
  });

  it("rejects mismatched target binary hash with TargetHashMismatchError", async () => {
    await store.annotateFunction(target, "0x140001000", { name: "MainEntry" });

    // Corrupt stored targetSha256
    const fs = await import("node:fs/promises");
    const filePath = join(tempDir, `${target.sha256}.json`);
    const content = JSON.parse(await fs.readFile(filePath, "utf8"));
    content.targetSha256 =
      "4444444444444444444444444444444444444444444444444444444444444444";
    await fs.writeFile(filePath, JSON.stringify(content), "utf8");

    await expect(store.load(target)).rejects.toThrow(TargetHashMismatchError);
  });
});
