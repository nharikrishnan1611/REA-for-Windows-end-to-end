import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AnnotationStore } from "../src/persistence/AnnotationStore.js";
import { observeWindowsUi } from "../src/ui/WindowsUiObserver.js";
import {
  createPngScreenshotRecord,
  MINIMAL_TEST_PNG,
} from "../src/ui/WindowsScreenshot.js";

describe("Workstream C: Preserve Original Target", () => {
  let targetDir: string;
  let analysisDir: string;
  let fixturePath: string;
  let originalSha256: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), "rea-target-preserve-"));
    analysisDir = await mkdtemp(join(tmpdir(), "rea-analysis-output-"));

    fixturePath = join(targetDir, "sample_protected.exe");

    // Create a deterministic mock PE binary (DOS header MZ + stub + PE header)
    const mockPe = Buffer.alloc(1024);
    mockPe.write("MZ", 0, "ascii");
    mockPe.writeUInt32LE(0x80, 0x3c); // PE header offset
    mockPe.write("PE\0\0", 0x80, "ascii");
    mockPe.write("MOCK_CODE_SECTION_BYTES", 0x100, "ascii");

    await writeFile(fixturePath, mockPe);

    originalSha256 = createHash("sha256").update(mockPe).digest("hex");
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
    await rm(analysisDir, { recursive: true, force: true });
  });

  it("leaves target file SHA-256 bit-for-bit unchanged after analysis and annotation", async () => {
    // 1. Verify initial hash
    const initialBytes = await readFile(fixturePath);
    expect(createHash("sha256").update(initialBytes).digest("hex")).toBe(
      originalSha256,
    );

    // 2. Perform durable annotation in dedicated analysisDir (OUTSIDE targetDir)
    const store = new AnnotationStore(analysisDir);
    await store.annotateFunction(
      { path: fixturePath, sha256: originalSha256 },
      "0x140001000",
      {
        name: "RenamedMain",
        comment: "Analysis comment",
      },
    );

    // 3. Perform UI observation with screenshot in memory
    const uiResult = await observeWindowsUi(
      {
        pid: 9999,
        window_id: 1234,
        sha256: originalSha256,
      },
      async () => ({
        window: {
          pid: 9999,
          window_id: 1234,
          executable: fixturePath,
          launch_time: Date.now(),
          title: "Preserved Target Window",
        },
        nodes: [],
        truncated: false,
        screenshot: createPngScreenshotRecord(MINIMAL_TEST_PNG),
        gaps: [],
      }),
    );

    expect(uiResult.target_sha256).toBe(originalSha256);

    // 4. Verify post-analysis file content and hash
    const postBytes = await readFile(fixturePath);
    const postSha256 = createHash("sha256").update(postBytes).digest("hex");

    expect(postSha256).toBe(originalSha256);
    expect(postBytes.equals(initialBytes)).toBe(true);
  });

  it("stores all persistent outputs strictly outside the target directory", async () => {
    const store = new AnnotationStore(analysisDir);
    await store.annotateFunction(
      { path: fixturePath, sha256: originalSha256 },
      "0x140001000",
      { name: "OutsideTargetCheck" },
    );

    // Read targetDir contents
    const fs = await import("node:fs/promises");
    const targetDirFiles = await fs.readdir(targetDir);

    // Must ONLY contain the original fixture file, nothing else!
    expect(targetDirFiles).toEqual(["sample_protected.exe"]);

    // The persistent annotation file MUST reside in analysisDir
    const analysisDirFiles = await fs.readdir(analysisDir);
    expect(analysisDirFiles).toContain(`${originalSha256}.json`);
  });
});
