# @rea/windows-parity

Windows-native feature parity extension for REA (Reverse Engineering Assistant).

## Overview

REA on Windows previously focused strictly on the read-only Windows Ghidra P0 boundary without GUI observation, annotation persistence, or function renaming. This package provides high-fidelity, verified Windows alternatives for workflows that previously depended on macOS/Hopper:

1. **Windows UI Automation & Screenshot Observation (`@rea/windows-parity/ui`)**:
   - Passive and scenario-based inspection using Microsoft UI Automation (`IUIAutomation` / `System.Windows.Automation`).
   - Traverses accessible control trees, roles, names, bounding rectangles, supported action patterns, and hierarchy paths.
   - Bounded control tree results (`max_nodes`, default 500) to protect agent context.
   - Automatic detection of custom-rendered canvas boundaries (Direct2D/OpenGL/DirectX/games) with honest limitation reporting.
   - User-authorized screenshot capture via Windows GDI (`CopyFromScreen` / `PrintWindow`) producing valid PNG base64, dimensions, and SHA-256 hashes.
   - Automatic redaction of sensitive input values (password boxes, tokens, auth keys).
   - Strictly read-only: no DLL injection, no process memory patching, no hooks.

2. **Durable Annotation Persistence (`@rea/windows-parity/persistence`)**:
   - Target-bound annotation storage (`AnnotationStore`) keyed strictly by stable target binary SHA-256 and schema version.
   - Preserves function renames, comments, inline comments, tags, and symbol names across process restarts.
   - Stored in dedicated analysis directory completely separate from binary bytes.
   - Validates target SHA-256: detects binary modifications and refuses to apply stale annotations silently (`TargetHashMismatchError`).
   - Full support for export, import, backup (`.bak`), and recovery.

3. **Windows Ghidra Capability Extension (`@rea/windows-parity/ghidra`)**:
   - Capability negotiation for Windows Ghidra sessions.
   - Safely authorizes metadata mutation (`annotate_native_function`, `set_address_name`, `set_addresses_names`) under operator authorization (`REA_ALLOW_WINDOWS_GHIDRA_MUTATION=1`).
   - Retains fail-closed security policy by default.
   - Input validation rejecting NUL bytes, unpaired surrogates, and malformed addresses.
   - Guarantees target binary bytes on disk are never patched.

## Installation & Usage

```bash
npm install @rea/windows-parity
```

### UI Observation Example

```typescript
import { observeWindowsUi } from "@rea/windows-parity/ui";

const result = await observeWindowsUi({
  pid: 1234,
  window_id: 5678,
  screenshot: true,
  accessibility: true,
  max_nodes: 500,
});

console.log("Window Title:", result.initial.window.title);
console.log("Nodes:", result.initial.nodes.length);
if (result.initial.screenshot) {
  console.log("Screenshot SHA-256:", result.initial.screenshot.sha256);
}
```

### Annotation Persistence Example

```typescript
import { AnnotationStore } from "@rea/windows-parity/persistence";

const store = new AnnotationStore("C:\\Users\\User\\.rea\\annotations");

// Save annotation for target
await store.annotateFunction(
  { path: "C:\\fixtures\\target.exe", sha256: "abcd...1234" },
  "0x140001000",
  {
    name: "CoreDispatchRoutine",
    comment: "Reverse-engineered license validation check",
  },
);

// Reload after process restart
const annotations = await store.load({
  path: "C:\\fixtures\\target.exe",
  sha256: "abcd...1234",
});
```

## Testing

```powershell
npx vitest run packages/windows-parity/tests
```
