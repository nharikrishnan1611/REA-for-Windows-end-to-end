import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnnotationStore,
  TargetHashMismatchError,
  type TargetIdentity,
} from "../src/persistence/AnnotationStore.js";

describe("AnnotationStore", () => {
  let tempDir: string;
  let store: AnnotationStore;

  const targetA: TargetIdentity = {
    path: "C:\\fixtures\\targetA.exe",
    sha256: "1111111111111111111111111111111111111111111111111111111111111111",
  };

  const targetB: TargetIdentity = {
    path: "C:\\fixtures\\targetB.exe",
    sha256: "2222222222222222222222222222222222222222222222222222222222222222",
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rea-annot-test-"));
    store = new AnnotationStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when no annotations exist for target", async () => {
    const loaded = await store.load(targetA);
    expect(loaded).toBeNull();
    expect(await store.has(targetA.sha256)).toBe(false);
  });

  it("saves and reloads function annotations", async () => {
    const fn = await store.annotateFunction(targetA, "0x140001000", {
      name: "entry_main",
      comment: "Analyzed main dispatch routine",
      inlineComment: "check license flag",
    });

    expect(fn.address).toBe("0x140001000");
    expect(fn.name).toBe("entry_main");
    expect(fn.comment).toBe("Analyzed main dispatch routine");

    const loaded = await store.load(targetA);
    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe("1.0.0");
    expect(loaded?.targetSha256).toBe(targetA.sha256);
    expect(loaded?.functions["0x140001000"]?.name).toBe("entry_main");
    expect(loaded?.functions["0x140001000"]?.comment).toBe(
      "Analyzed main dispatch routine",
    );
  });

  it("persists annotations across simulated process restarts", async () => {
    await store.annotateFunction(targetA, "0x140002000", {
      name: "sub_critical",
      comment: "Persistent comment across session restarts",
    });
    await store.setAddressName(targetA, "0x140005000", "g_ConfigTable");

    // Simulate new process instance opening the same storage directory
    const secondStore = new AnnotationStore(tempDir);
    const loaded = await secondStore.load(targetA);

    expect(loaded).not.toBeNull();
    expect(loaded?.functions["0x140002000"]?.name).toBe("sub_critical");
    expect(loaded?.symbols["0x140005000"]?.name).toBe("g_ConfigTable");
  });

  it("rejects loading annotations when target SHA-256 does not match", async () => {
    // Save annotations for Target A
    await store.annotateFunction(targetA, "0x140001000", {
      name: "entry_main",
    });

    // Attempt to load Target A's file under Target B's identity
    const spoofedTarget: TargetIdentity = {
      path: targetB.path,
      sha256: targetA.sha256, // same file on disk, but we manipulate file
    };

    // If file contains targetA hash, but target requested has different hash:
    const mismatchedTarget: TargetIdentity = {
      path: targetA.path,
      sha256:
        "9999999999999999999999999999999999999999999999999999999999999999",
    };

    // The store should not find it (returns null for non-existent hash)
    expect(await store.load(mismatchedTarget)).toBeNull();

    // If a stored file was somehow corrupted or swapped with mismatched content:
    const corruptedJson = JSON.stringify({
      schemaVersion: "1.0.0",
      targetSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      targetPath: targetA.path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      functions: {},
      symbols: {},
      tags: {},
    });

    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(tempDir, `${targetA.sha256}.json`),
      corruptedJson,
      "utf8",
    );

    await expect(store.load(targetA)).rejects.toThrow(TargetHashMismatchError);
  });

  it("supports backup, modification, and restoration", async () => {
    await store.annotateFunction(targetA, "0x140001000", {
      name: "original_name",
    });
    await store.backup(targetA.sha256);

    // Modify
    await store.annotateFunction(targetA, "0x140001000", {
      name: "modified_name",
    });
    let current = await store.load(targetA);
    expect(current?.functions["0x140001000"]?.name).toBe("modified_name");

    // Restore
    const restored = await store.restore(targetA.sha256);
    expect(restored.functions["0x140001000"]?.name).toBe("original_name");

    current = await store.load(targetA);
    expect(current?.functions["0x140001000"]?.name).toBe("original_name");
  });

  it("exports and imports serialized annotation bundles", async () => {
    await store.annotateFunction(targetA, "0x140001000", {
      name: "exported_fn",
    });
    const exportedJson = await store.export(targetA.sha256);
    expect(exportedJson).toContain("exported_fn");

    // Clear
    await store.clear(targetA.sha256);
    expect(await store.load(targetA)).toBeNull();

    // Re-import
    const imported = await store.import(exportedJson, targetA.sha256);
    expect(imported.functions["0x140001000"]?.name).toBe("exported_fn");

    const reloaded = await store.load(targetA);
    expect(reloaded?.functions["0x140001000"]?.name).toBe("exported_fn");
  });
});
