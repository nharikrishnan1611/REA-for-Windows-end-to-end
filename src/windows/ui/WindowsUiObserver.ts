import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateUiAutomationScript } from "./WindowsUiAutomationScript.js";
import {
  createPngScreenshotRecord,
  isPngBuffer,
  readPngDimensions,
} from "./WindowsScreenshot.js";
import type {
  WindowsUiObservationOptions,
  WindowsUiResult,
  WindowsUiSnapshot,
} from "./types.js";

const execFileAsync = promisify(execFile);

export type WindowsUiInvoker = (
  options: WindowsUiObservationOptions,
  signal?: AbortSignal,
) => Promise<WindowsUiSnapshot>;

export const DEFAULT_OBSERVATION_LIMITATIONS: readonly string[] = Object.freeze(
  [
    "Windows UI Automation observes accessible Win32, WPF, UWP, and WinUI controls; custom-rendered Direct2D/OpenGL/DirectX surfaces without accessible semantics expose limited metadata.",
    "Screenshot capture reflects visual state rendered at capture time and requires desktop composition; minimized or protected windows may return black frames or empty bounds.",
    "Sensitive control values (e.g., password boxes) are redacted by default to preserve privacy.",
  ],
);

/**
 * Execute real Windows UI Automation inspection of a target process and window.
 */
export async function executeWindowsUiObservation(
  options: WindowsUiObservationOptions,
  signal?: AbortSignal,
): Promise<WindowsUiSnapshot> {
  const pid = options.pid;
  const windowId = options.window_id;
  const maxNodes = options.max_nodes ?? 500;
  const captureScreenshot = options.screenshot ?? true;
  const captureAccessibility = options.accessibility ?? true;
  const redactSensitive = options.redactSensitive ?? true;
  const timeoutMs = options.timeoutMs ?? 30000;

  if (pid <= 0 || !Number.isSafeInteger(pid)) {
    throw new Error(`Invalid process ID: ${pid}. Must be a positive integer.`);
  }
  if (windowId <= 0 || !Number.isSafeInteger(windowId)) {
    throw new Error(
      `Invalid window ID: ${windowId}. Must be a positive integer.`,
    );
  }
  if (!captureScreenshot && !captureAccessibility) {
    throw new Error(
      "At least one of screenshot or accessibility must be enabled.",
    );
  }

  const scriptContent = generateUiAutomationScript({
    pid,
    windowId,
    maxNodes,
    captureScreenshot,
    captureAccessibility,
    redactSensitive,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "rea-uia-"));
  const scriptPath = join(tempDir, `uia_${Date.now()}_${pid}.ps1`);

  try {
    await writeFile(scriptPath, scriptContent, "utf8");

    const execPromise = execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        signal,
      },
    );

    const { stdout } = await execPromise;
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error("Windows UI Automation helper returned empty output.");
    }

    const parsed = JSON.parse(trimmed) as
      | { ok: true; result: WindowsUiSnapshot }
      | { ok: false; code: string; message: string };

    if (!parsed.ok) {
      throw new Error(`[${parsed.code}] ${parsed.message}`);
    }

    // Validate screenshot if present
    if (parsed.result.screenshot) {
      const buffer = Buffer.from(parsed.result.screenshot.base64, "base64");
      if (!isPngBuffer(buffer)) {
        throw new Error(
          "Captured screenshot does not contain valid PNG bytes.",
        );
      }
      const dims = readPngDimensions(buffer);
      if (!dims) {
        throw new Error(
          "Failed to read PNG dimensions from captured screenshot.",
        );
      }
    }

    return parsed.result;
  } finally {
    try {
      await unlink(scriptPath);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * High-level observeWindowsUi matching REA's NativeUiObservation interface.
 */
export async function observeWindowsUi(
  options: WindowsUiObservationOptions,
  customInvoker?: WindowsUiInvoker,
  signal?: AbortSignal,
): Promise<WindowsUiResult> {
  const invoker = customInvoker ?? executeWindowsUiObservation;
  const snapshot = await invoker(options, signal);

  return {
    target_sha256: options.sha256 ?? "0".repeat(64),
    initial: snapshot,
    steps: [],
    restore: "leave-as-is",
    limitations: [...DEFAULT_OBSERVATION_LIMITATIONS, ...snapshot.gaps],
  };
}
