import { describe, expect, it } from "vitest";
import {
  windowsP0Capabilities,
  CAPABILITIES,
  GHIDRA_OPERATIONS,
} from "./GhidraProviderCapabilities.js";
import { GHIDRA_MUTATING_OPERATIONS } from "./GhidraSessionValues.js";

describe("windowsP0Capabilities", () => {
  it("keeps database mutation unavailable by default on Windows host", () => {
    const caps = windowsP0Capabilities({ available: true }, false);
    const mutatingCaps = caps.filter((c) =>
      GHIDRA_MUTATING_OPERATIONS.has(c.operation),
    );

    expect(mutatingCaps).toHaveLength(3);
    for (const cap of mutatingCaps) {
      expect(cap.available).toBe(false);
      expect(cap.reason).toBe(
        "Windows Ghidra P0 does not admit database mutation.",
      );
      expect(cap.availabilityCode).toBe("unsupported_host");
    }

    // Read operations should be available
    const readCap = caps.find((c) => c.operation === "analyze_function");
    expect(readCap?.available).toBe(true);
  });

  it("enables database mutation when explicitly authorized and native readiness is true", () => {
    const caps = windowsP0Capabilities({ available: true }, true);
    const mutatingCaps = caps.filter((c) =>
      GHIDRA_MUTATING_OPERATIONS.has(c.operation),
    );

    expect(mutatingCaps).toHaveLength(3);
    for (const cap of mutatingCaps) {
      expect(cap.available).toBe(true);
      expect(cap.reason).toBeNull();
      expect(cap.limitations.join(" ")).toContain(
        "original executable bytes are NEVER patched",
      );
    }
  });

  it("reports native failure when native readiness is false even if mutation is authorized", () => {
    const caps = windowsP0Capabilities(
      {
        available: false,
        reason: "Native authority not proven",
        failureStage: "load",
        code: "runtime_missing",
        remediation: "Install native addon",
        proof: "not-proven",
      },
      true,
    );

    for (const cap of caps) {
      expect(cap.available).toBe(false);
      expect(cap.reason).toBe("Native authority not proven");
      expect(cap.availabilityCode).toBe("runtime_missing");
    }
  });
});
