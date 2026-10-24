export interface WindowsGhidraMutationOptions {
  readonly allowMutation?: boolean | undefined;
  readonly nativeReadinessAvailable?: boolean | undefined;
  readonly unreadinessReason?: string | null | undefined;
}

export interface WindowsGhidraCapabilityDescriptor {
  readonly operation: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly availabilityCode?: string | undefined;
  readonly mutatesArtifact: boolean;
  readonly limitations: readonly string[];
}

export const WINDOWS_GHIDRA_MUTATING_OPERATIONS: readonly string[] =
  Object.freeze([
    "annotate_native_function",
    "set_address_name",
    "set_addresses_names",
  ]);

export const WINDOWS_GHIDRA_READ_OPERATIONS: readonly string[] = Object.freeze([
  "binary_overview",
  "read_binary_inventory_summary",
  "inspect_native_load_image",
  "read_bytes",
  "search_bytes",
  "address_to_file_offset",
  "address_name",
  "list_documents",
  "list_names",
  "list_procedures",
  "list_segments",
  "list_strings",
  "procedure_address",
  "resolve_containing_procedure",
  "search_procedures",
  "search_strings",
  "procedure_pseudo_code",
  "read_function_instructions",
  "procedure_assembly",
  "procedure_callees",
  "procedure_callers",
  "procedure_info",
  "xrefs",
  "procedure_references",
  "analyze_function",
]);

const COMMON_LIMITATIONS = Object.freeze([
  "Windows Ghidra operates on an ephemeral imported program database; original executable bytes are NEVER patched.",
  "Windows sessions require local NTFS targets, matching Windows x64 native controls, and Windows 10 or later.",
]);

/**
 * Validate a mutation request (address, name, comment).
 */
export function validateMutationRequest(params: {
  readonly address: string;
  readonly name?: string | undefined;
  readonly comment?: string | undefined;
}): { ok: true } | { ok: false; error: string } {
  if (!/^0x[0-9a-fA-F]+$/u.test(params.address)) {
    return {
      ok: false,
      error: `Invalid address coordinate "${params.address}". Must be lowercase or uppercase 0x-prefixed hexadecimal.`,
    };
  }

  if (params.name !== undefined) {
    if (params.name.includes("\0")) {
      return { ok: false, error: "Symbol name cannot contain NUL bytes." };
    }
    if (params.name.trim().length === 0) {
      return {
        ok: false,
        error: "Symbol name cannot be empty or whitespace only.",
      };
    }
    if (/[\uD800-\uDFFF]/u.test(params.name)) {
      return {
        ok: false,
        error: "Symbol name cannot contain unpaired Unicode surrogates.",
      };
    }
  }

  if (params.comment !== undefined) {
    if (params.comment.includes("\0")) {
      return { ok: false, error: "Comment cannot contain NUL bytes." };
    }
    if (/[\uD800-\uDFFF]/u.test(params.comment)) {
      return {
        ok: false,
        error: "Comment cannot contain unpaired Unicode surrogates.",
      };
    }
  }

  return { ok: true };
}

/**
 * Resolve Windows Ghidra capabilities according to host readiness and mutation policy.
 */
export function resolveWindowsGhidraCapabilities(
  options: WindowsGhidraMutationOptions = {},
): readonly WindowsGhidraCapabilityDescriptor[] {
  const allowMutation =
    options.allowMutation ??
    (typeof process !== "undefined" &&
      process.env.REA_ALLOW_WINDOWS_GHIDRA_MUTATION === "1");

  const readinessAvailable = options.nativeReadinessAvailable ?? true;
  const unreadinessReason =
    options.unreadinessReason ?? "Windows native controls not proven.";

  const mutatingSet = new Set(WINDOWS_GHIDRA_MUTATING_OPERATIONS);

  const allOps = [
    ...WINDOWS_GHIDRA_READ_OPERATIONS,
    ...WINDOWS_GHIDRA_MUTATING_OPERATIONS,
  ];

  return Object.freeze(
    allOps.map((operation) => {
      const isMutating = mutatingSet.has(operation);

      if (!readinessAvailable) {
        return Object.freeze({
          operation,
          available: false,
          reason: unreadinessReason,
          availabilityCode: "runtime_unavailable",
          mutatesArtifact: isMutating,
          limitations: COMMON_LIMITATIONS,
        });
      }

      if (isMutating) {
        if (!allowMutation) {
          return Object.freeze({
            operation,
            available: false,
            reason:
              "Windows Ghidra database mutation requires explicit authorization ($env:REA_ALLOW_WINDOWS_GHIDRA_MUTATION=1 or allowMutation: true).",
            availabilityCode: "unsupported_host",
            mutatesArtifact: true,
            limitations: [
              ...COMMON_LIMITATIONS,
              "Mutation is disabled by default under Windows Ghidra fail-closed policy.",
            ],
          });
        }

        return Object.freeze({
          operation,
          available: true,
          reason: null,
          mutatesArtifact: true,
          limitations: [
            ...COMMON_LIMITATIONS,
            "Names and comments edit ephemeral session database metadata; original executable bytes are NEVER patched.",
            "Metadata edits invalidate cached immutable analysis snapshots and are discarded on close unless saved through an explicit annotation store.",
          ],
        });
      }

      return Object.freeze({
        operation,
        available: true,
        reason: null,
        mutatesArtifact: false,
        limitations: COMMON_LIMITATIONS,
      });
    }),
  );
}
