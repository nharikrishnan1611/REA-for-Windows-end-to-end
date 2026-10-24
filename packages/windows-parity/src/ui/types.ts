/** Bounding box coordinates for a UI element on Windows. */
export interface WindowsUiBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One accessible node in the UI Automation tree hierarchy. */
export interface WindowsUiNode {
  readonly path: readonly number[];
  readonly role: string | null;
  readonly title: string | null;
  readonly value: string | number | boolean | null;
  readonly actions: readonly string[];
  readonly children_count: number | null;
  readonly bounds?: WindowsUiBounds | undefined;
}

/** Window metadata observed from Microsoft UI Automation and Win32. */
export interface WindowsUiWindow {
  readonly pid: number;
  readonly window_id: number;
  readonly executable: string;
  readonly launch_time: number;
  readonly title: string;
}

/** Verified PNG screenshot bytes, dimensions, and cryptographic digest. */
export interface WindowsUiScreenshot {
  readonly mime_type: "image/png";
  readonly base64: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

/** Complete snapshot of an application window state. */
export interface WindowsUiSnapshot {
  readonly window: WindowsUiWindow;
  readonly nodes: readonly WindowsUiNode[];
  readonly truncated: boolean;
  readonly screenshot: WindowsUiScreenshot | null;
  readonly gaps: readonly string[];
}

/** Caller options for observing a Windows UI window. */
export interface WindowsUiObservationOptions {
  readonly pid: number;
  readonly window_id: number;
  readonly screenshot?: boolean | undefined;
  readonly accessibility?: boolean | undefined;
  readonly max_nodes?: number | undefined;
  readonly redactSensitive?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly executable?: string | undefined;
  readonly sha256?: string | undefined;
}

/** Final structured observation result compatible with REA's nativeUiResultSchema. */
export interface WindowsUiResult {
  readonly target_sha256: string;
  readonly initial: WindowsUiSnapshot;
  readonly steps: readonly never[];
  readonly restore: "leave-as-is";
  readonly limitations: readonly string[];
}
