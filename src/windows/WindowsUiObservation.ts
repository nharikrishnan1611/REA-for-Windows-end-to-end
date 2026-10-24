import { z } from "zod";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  nativeUiObservationInputSchema,
  nativeUiScenarioInputSchema,
  nativeUiResultSchema,
} from "../domain/native/nativeUiObservation.js";
import {
  AnalysisInputError,
  AnalysisCapabilityUnavailableError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { ok, err, type Result } from "../domain/result.js";
import {
  observeWindowsUi,
  type WindowsUiInvoker,
} from "../../packages/windows-parity/src/ui/WindowsUiObserver.js";
import type { WindowsUiSnapshot } from "../../packages/windows-parity/src/ui/types.js";

const passiveInputSchema = nativeUiObservationInputSchema.transform(
  (input) => ({ ...input, steps: [] }),
);

export type WindowsUiObservationOptions = {
  signal?: AbortSignal | undefined;
  invoke?: WindowsUiInvoker | undefined;
};

/**
 * Observe a Windows UI target window via Microsoft UI Automation and GDI screenshot capture.
 * Preserves the original target executable completely untouched.
 */
export async function observeWindowsNativeUi(
  target: BinaryTarget,
  operation: "observe_native_ui" | "capture_native_ui_scenario",
  parameters: unknown,
  options: WindowsUiObservationOptions = {},
): Promise<Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>> {
  const parsed = (
    operation === "observe_native_ui"
      ? passiveInputSchema
      : nativeUiScenarioInputSchema
  ).safeParse(parameters);

  if (!parsed.success) {
    return err(new AnalysisInputError(operation, { cause: parsed.error }));
  }

  const input = parsed.data;
  if (!input.screenshot && !input.accessibility) {
    return err(
      new AnalysisInputError(operation, {
        cause: new Error("Enable screenshot or accessibility capture"),
      }),
    );
  }

  try {
    const observationResult = await observeWindowsUi(
      {
        pid: input.pid,
        window_id: input.window_id,
        screenshot: input.screenshot,
        accessibility: input.accessibility,
        max_nodes: input.max_nodes,
        executable: target.path,
        sha256: target.sha256,
      },
      options.invoke,
      options.signal,
    );

    // Validate that the output conforms exactly to nativeUiResultSchema
    const validated = nativeUiResultSchema.parse(observationResult);
    return ok(validated);
  } catch (cause: unknown) {
    return err(
      new AnalysisInputError(operation, {
        userMessage: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
    );
  }
}
