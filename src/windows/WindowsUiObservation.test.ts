import { describe, it, expect } from "vitest";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { observeWindowsNativeUi } from "./WindowsUiObservation.js";
import {
  createPngScreenshotRecord,
  MINIMAL_TEST_PNG,
} from "../../packages/windows-parity/src/ui/WindowsScreenshot.js";

const peTarget: BinaryTarget = {
  path: "C:\\fixtures\\sample.exe",
  sha256: "5555555555555555555555555555555555555555555555555555555555555555",
  kind: "executable",
  format: "pe",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
  executableRole: "application",
  managed: false,
};

describe("observeWindowsNativeUi", () => {
  it("returns formatted result conforming to nativeUiResultSchema", async () => {
    const result = await observeWindowsNativeUi(
      peTarget,
      "observe_native_ui",
      {
        pid: 1234,
        window_id: 5678,
        screenshot: true,
        accessibility: true,
      },
      {
        invoke: async () => ({
          window: {
            pid: 1234,
            window_id: 5678,
            executable: peTarget.path,
            launch_time: 1700000000000,
            title: "Test Window",
          },
          nodes: [
            {
              path: [],
              role: "window",
              title: "Test Window",
              value: null,
              actions: [],
              children_count: 1,
            },
            {
              path: [0],
              role: "button",
              title: "OK",
              value: null,
              actions: ["click"],
              children_count: 0,
            },
          ],
          truncated: false,
          screenshot: createPngScreenshotRecord(MINIMAL_TEST_PNG),
          gaps: [],
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.target_sha256).toBe(peTarget.sha256);
    expect(result.value.initial.window.pid).toBe(1234);
    expect(result.value.initial.window.title).toBe("Test Window");
    expect(result.value.initial.nodes).toHaveLength(2);
    expect(result.value.restore).toBe("leave-as-is");
    expect(result.value.limitations.length).toBeGreaterThan(0);
  });

  it("fails when both screenshot and accessibility are disabled", async () => {
    const result = await observeWindowsNativeUi(peTarget, "observe_native_ui", {
      pid: 1234,
      window_id: 5678,
      screenshot: false,
      accessibility: false,
    });

    expect(result.ok).toBe(false);
  });
});
