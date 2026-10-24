import { describe, it, expect } from "vitest";
import {
  executeWindowsUiObservation,
  observeWindowsUi,
  DEFAULT_OBSERVATION_LIMITATIONS,
} from "../src/ui/WindowsUiObserver.js";
import {
  createPngScreenshotRecord,
  isPngBuffer,
  readPngDimensions,
  MINIMAL_TEST_PNG,
} from "../src/ui/WindowsScreenshot.js";
import { generateUiAutomationScript } from "../src/ui/WindowsUiAutomationScript.js";
import type { WindowsUiSnapshot } from "../src/ui/types.js";

describe("WindowsScreenshot utilities", () => {
  it("verifies PNG header and dimensions on minimal test PNG", () => {
    expect(isPngBuffer(MINIMAL_TEST_PNG)).toBe(true);
    const dims = readPngDimensions(MINIMAL_TEST_PNG);
    expect(dims).toEqual({ width: 1, height: 1 });
  });

  it("creates verified screenshot record with matching sha256", () => {
    const record = createPngScreenshotRecord(MINIMAL_TEST_PNG);
    expect(record.mime_type).toBe("image/png");
    expect(record.width).toBe(1);
    expect(record.height).toBe(1);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(record.base64, "base64")).toEqual(MINIMAL_TEST_PNG);
  });

  it("rejects non-PNG buffer", () => {
    const garbage = Buffer.from("NOT_A_PNG_FILE_DATA");
    expect(isPngBuffer(garbage)).toBe(false);
    expect(readPngDimensions(garbage)).toBeUndefined();
    expect(() => createPngScreenshotRecord(garbage)).toThrow(
      /Invalid PNG buffer/,
    );
  });
});

describe("WindowsUiAutomationScript generator", () => {
  it("generates script containing targeted PID, HWND, and maxNodes", () => {
    const script = generateUiAutomationScript({
      pid: 1234,
      windowId: 5678,
      maxNodes: 250,
      captureScreenshot: true,
      captureAccessibility: true,
      redactSensitive: true,
    });
    expect(script).toContain("$targetPid = 1234");
    expect(script).toContain("$targetHwnd = [IntPtr]5678");
    expect(script).toContain("$maxNodes = 250");
    expect(script).toContain("$captureScreenshot = $true");
    expect(script).toContain("$captureAccessibility = $true");
    expect(script).toContain("$redactSensitive = $true");
    expect(script).toContain("[REDACTED]");
    expect(script).toContain("Custom-rendered or protected canvas");
  });
});

describe("WindowsUiObserver input validation", () => {
  it("rejects non-positive PID", async () => {
    await expect(
      executeWindowsUiObservation({ pid: 0, window_id: 100 }),
    ).rejects.toThrow(/Invalid process ID/);
    await expect(
      executeWindowsUiObservation({ pid: -5, window_id: 100 }),
    ).rejects.toThrow(/Invalid process ID/);
  });

  it("rejects non-positive window ID", async () => {
    await expect(
      executeWindowsUiObservation({ pid: 100, window_id: 0 }),
    ).rejects.toThrow(/Invalid window ID/);
    await expect(
      executeWindowsUiObservation({ pid: 100, window_id: -1 }),
    ).rejects.toThrow(/Invalid window ID/);
  });

  it("rejects when both screenshot and accessibility are disabled", async () => {
    await expect(
      executeWindowsUiObservation({
        pid: 100,
        window_id: 200,
        screenshot: false,
        accessibility: false,
      }),
    ).rejects.toThrow(
      /At least one of screenshot or accessibility must be enabled/,
    );
  });
});

describe("observeWindowsUi with mock invoker", () => {
  const mockSnapshot: WindowsUiSnapshot = {
    window: {
      pid: 1234,
      window_id: 5678,
      executable: "C:\\Program Files\\App\\app.exe",
      launch_time: 1700000000000,
      title: "Sample App Window",
    },
    nodes: [
      {
        path: [],
        role: "window",
        title: "Sample App Window",
        value: null,
        actions: [],
        children_count: 2,
      },
      {
        path: [0],
        role: "button",
        title: "Submit",
        value: null,
        actions: ["click"],
        children_count: 0,
      },
      {
        path: [1],
        role: "edit",
        title: "Password",
        value: "[REDACTED]",
        actions: ["key-entry"],
        children_count: 0,
      },
    ],
    truncated: false,
    screenshot: createPngScreenshotRecord(MINIMAL_TEST_PNG),
    gaps: [],
  };

  it("constructs full observation result matching REA schema", async () => {
    const result = await observeWindowsUi(
      {
        pid: 1234,
        window_id: 5678,
        sha256: "b".repeat(64),
      },
      async () => mockSnapshot,
    );

    expect(result.target_sha256).toBe("b".repeat(64));
    expect(result.restore).toBe("leave-as-is");
    expect(result.steps).toEqual([]);
    expect(result.initial.window.pid).toBe(1234);
    expect(result.initial.window.window_id).toBe(5678);
    expect(result.initial.nodes).toHaveLength(3);
    expect(result.initial.nodes[2]!.value).toBe("[REDACTED]");
    expect(result.initial.screenshot?.mime_type).toBe("image/png");
    expect(result.limitations).toEqual(
      expect.arrayContaining(
        DEFAULT_OBSERVATION_LIMITATIONS as unknown as string[],
      ),
    );
  });

  it("retains limitation gaps reported by custom-rendered interface", async () => {
    const canvasSnapshot: WindowsUiSnapshot = {
      ...mockSnapshot,
      nodes: [mockSnapshot.nodes[0]!],
      gaps: [
        "Custom-rendered or protected canvas exposes insufficient accessibility metadata",
      ],
    };

    const result = await observeWindowsUi(
      { pid: 1234, window_id: 5678 },
      async () => canvasSnapshot,
    );

    expect(result.limitations).toContain(
      "Custom-rendered or protected canvas exposes insufficient accessibility metadata",
    );
  });
});
