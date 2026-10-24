import { describe, it, expect } from "vitest";
import {
  resolveWindowsGhidraCapabilities,
  validateMutationRequest,
  WINDOWS_GHIDRA_MUTATING_OPERATIONS,
} from "../src/ghidra/WindowsGhidraCapabilities.js";

describe("WindowsGhidraCapabilities", () => {
  it("disables mutating operations by default under fail-closed policy", () => {
    const caps = resolveWindowsGhidraCapabilities({ allowMutation: false });
    const mutatingCaps = caps.filter((c) =>
      WINDOWS_GHIDRA_MUTATING_OPERATIONS.includes(c.operation),
    );

    expect(mutatingCaps).toHaveLength(3);
    for (const cap of mutatingCaps) {
      expect(cap.available).toBe(false);
      expect(cap.reason).toContain("requires explicit authorization");
      expect(cap.availabilityCode).toBe("unsupported_host");
    }

    // Read operations should remain available
    const readCap = caps.find((c) => c.operation === "analyze_function");
    expect(readCap?.available).toBe(true);
  });

  it("enables mutating operations when explicitly authorized", () => {
    const caps = resolveWindowsGhidraCapabilities({ allowMutation: true });
    const mutatingCaps = caps.filter((c) =>
      WINDOWS_GHIDRA_MUTATING_OPERATIONS.includes(c.operation),
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

  it("reports runtime_unavailable when host readiness fails", () => {
    const caps = resolveWindowsGhidraCapabilities({
      allowMutation: true,
      nativeReadinessAvailable: false,
      unreadinessReason: "Missing Windows x64 native security addon.",
    });

    for (const cap of caps) {
      expect(cap.available).toBe(false);
      expect(cap.reason).toBe("Missing Windows x64 native security addon.");
      expect(cap.availabilityCode).toBe("runtime_unavailable");
    }
  });

  describe("validateMutationRequest", () => {
    it("accepts valid hexadecimal addresses and clean names", () => {
      const valid = validateMutationRequest({
        address: "0x140001000",
        name: "ProcessData",
        comment: "Main loop dispatch",
      });
      expect(valid.ok).toBe(true);
    });

    it("rejects non-hexadecimal address", () => {
      const invalid = validateMutationRequest({
        address: "140001000", // missing 0x
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error).toContain("Invalid address coordinate");
      }
    });

    it("rejects names containing NUL bytes", () => {
      const invalid = validateMutationRequest({
        address: "0x401000",
        name: "foo\0bar",
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error).toContain("NUL bytes");
      }
    });

    it("rejects names containing unpaired Unicode surrogates", () => {
      const invalid = validateMutationRequest({
        address: "0x401000",
        name: "test\uD800name",
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error).toContain("unpaired Unicode surrogates");
      }
    });
  });
});
