# 🪟 REA Windows: Beyond Hopper

### End-to-End Windows Native Reverse Engineering, GUI Observation, and Durable Annotations

![REA for Windows End-to-End](docs/assets/rea_windows_hero.jpg)

[![Windows Tests](https://img.shields.io/badge/tests-289%20passed-brightgreen?style=flat-square)](packages/windows-parity/tests)
[![Typecheck & Lint](https://img.shields.io/badge/turborepo-clean-success?style=flat-square)](turbo.json)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-blue?style=flat-square)](#)
[![Package](https://img.shields.io/badge/%40rea-windows--parity-blueviolet?style=flat-square)](packages/windows-parity)
[![License](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)

---

## ⚡ Executive Summary

[REA (Reverse Engineering Assistant)](https://github.com/morluto/rea) is a unified CLI and Model Context Protocol (MCP) server that empowers AI coding agents and human analysts to inspect, decompile, and reverse engineer compiled applications.

Historically, REA suffered a major platform divide: **deep interactive workflows were locked behind macOS and Hopper Disassembler**. On Windows, analysts were constrained to a strictly read-only P0 Ghidra boundary with **zero GUI observation**, **zero database mutation authority**, and **ephemeral sessions** that lost all analysis annotations on process exit.

**REA Windows: Beyond Hopper** breaks this barrier by delivering verified, Windows-native alternatives for Hopper-dependent workflows:

1. **Microsoft UI Automation & Screenshot Observation**: Native accessibility tree traversal and GDI screenshot capture for Windows desktop applications without DLL injection, API hooking, or memory patching.
2. **Durable Target-Bound Annotation Vault**: A schema-versioned metadata store keyed strictly by the target binary's cryptographic SHA-256 hash, persisting function renames, comments, and symbols across ephemeral Ghidra sessions and process restarts.
3. **Safe Ghidra Mutation Authority**: Controlled, authorized database metadata editing (`annotate_native_function`, `set_address_name`, `set_addresses_names`) under fail-closed security invariants, guaranteeing that the target executable on disk is **never patched**.

---

## 🏗️ Architecture & Core Pillars

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                REA CLI / MCP Server                                     │
└────────────────────────────────────────┬────────────────────────────────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │    Native PE Analysis     │                   │  Windows UI/GUI Observer  │
   │      (Headless Ghidra)    │                   │   (Microsoft UI Auto)     │
   └─────────────┬─────────────┘                   └─────────────┬─────────────┘
                 │                                               │
                 ├───────────────────────┬───────────────────────┤
                 ▼                       ▼                       ▼
   ┌───────────────────────────┐ ┌───────────────┐ ┌───────────────────────────┐
   │ Authorized Metadata Edits │ │ In-Memory GDI │ │ Durable Annotation Store  │
   │   (Renames & Comments)    │ │  Screenshots  │ │   (SHA-256 Target-Bound)  │
   │ *Target Bytes Untouched*  │ │  (PNG/SHA256) │ │ *Survives Session Restart*│
   └───────────────────────────┘ └───────────────┘ └───────────────────────────┘
```

### 1. Microsoft UI Automation & Screenshot Observation (`@rea/windows-parity/ui`)

- **Native UIA Engine**: Traverses accessible Win32, WPF, UWP, and WinUI control trees natively using Microsoft UI Automation (`System.Windows.Automation`) via PowerShell / .NET without external C++ compilation dependencies.
- **Hierarchical Control Tree**: Captures control roles, names, bounding rectangles, supported UI patterns (`Invoke`, `Toggle`, `Scroll`, `Value`), and parent-child hierarchy paths.
- **Context Protection**: Bounded traversal (`max_nodes: 500`) prevents agent context exhaustion and sets `truncated: true` when bounds are reached.
- **Privacy & Secret Redaction**: Automatically scans controls and redacts password fields and auth tokens matching `password|token|secret|pin|credit|auth` to `"[REDACTED]"`.
- **In-Memory GDI Screenshot Capture**: Captures exact window frames to PNG memory streams, validating the PNG 8-byte magic signature, verifying dimensions in the IHDR chunk, and computing cryptographic SHA-256 digests.
- **Limitation Reporting**: Honestly detects and reports custom-rendered canvas boundaries (Direct2D, DirectX, OpenGL, Flutter, games) that expose limited accessibility semantics.

### 2. Durable Target-Bound Annotation Vault (`@rea/windows-parity/persistence`)

- **The Ephemeral State Problem**: Headless Ghidra sessions in REA are strictly ephemeral; all analysis state, decompilation cache, and project databases are deleted on session closure.
- **The Solution**: An isolated, file-based metadata store ([`AnnotationStore`](packages/windows-parity/src/persistence/AnnotationStore.ts)) keyed strictly by the target binary's 64-character SHA-256 hash.
- **Cryptographic Binding**: If a binary is altered or swapped on disk, the store detects the digest mismatch and throws `TargetHashMismatchError`, preventing stale annotations from being silently applied.
- **Survives Process Restarts**: Re-instantiating the store reloads function renames, comments, inline comments, tags, and symbols across tool executions.
- **Backup & Recovery**: Built-in snapshot backup (`.bak`), restore, JSON export, and import.

### 3. Controlled Ghidra Mutation Authority (`@rea/windows-parity/ghidra`)

- **Explicit Operator Authorization**: Mutating operations remain disabled by default under REA's fail-closed security policy. They are enabled only with explicit operator authorization (`allowMutation: true` or `process.env.REA_ALLOW_WINDOWS_GHIDRA_MUTATION = "1"`).
- **Target Byte Immutability**: All function renames and comments mutate only ephemeral session database metadata; **executable bytes on disk are never patched**.
- **Input Sanitization**: Rejects NUL bytes, unpaired Unicode surrogates, and malformed addresses before bridge dispatch.

---

## 📦 Packaging & Source Layout

The project is structured into a clean, standalone package and deep REA core integrations:

```
rea-for-windows-end-to-end/
├── packages/
│   └── windows-parity/                  # Standalone NPM package (@rea/windows-parity)
│       ├── package.json                 # Standalone package metadata & exports
│       ├── tsconfig.json                # Pinned TypeScript configuration
│       ├── README.md                    # Package documentation
│       ├── src/
│       │   ├── ui/                      # Windows UI Automation & GDI Screenshot
│       │   │   ├── WindowsUiObserver.ts
│       │   │   ├── WindowsUiAutomationScript.ts
│       │   │   ├── WindowsScreenshot.ts
│       │   │   └── types.ts
│       │   ├── persistence/             # Durable Annotation Store
│       │   │   └── AnnotationStore.ts
│       │   └── ghidra/                  # Windows Ghidra capability negotiation
│       │       └── WindowsGhidraCapabilities.ts
│       └── tests/                       # Standalone package test battery
│           ├── WindowsUiObserver.test.ts
│           ├── AnnotationStore.test.ts
│           ├── TargetPreservation.test.ts
│           ├── WindowsGhidraCapabilities.test.ts
│           └── WindowsUiRealIntegration.test.ts
├── src/
│   ├── windows/                         # REA Windows Core Adapters
│   │   ├── WindowsUiObservation.ts      # observe_native_ui adapter for Windows PE
│   │   ├── WindowsAnnotationStore.ts    # Re-exported persistence vault
│   │   ├── WindowsUiObservation.test.ts
│   │   └── WindowsAnnotationStore.test.ts
│   ├── native/                          # Unified native observation
│   │   └── NativeUiObservation.ts       # Routes PE targets on Windows to UIA
│   └── ghidra/                          # Ghidra provider engine
│       ├── GhidraProviderCapabilities.ts# Configurable mutation policy
│       └── GhidraProviderCapabilities.test.ts
├── docs/
│   ├── assets/rea_windows_hero.jpg      # System architecture visual
│   ├── windows-feature-matrix.md        # Comprehensive parity matrix
│   └── windows-ghidra-p0.md             # Baseline P0 specifications
└── README_WINDOWS.md                    # Extended technical guide
```

---

## 🧪 Verified Test Battery (289 Passed, 0 Failed)

The entire test battery runs natively on Windows 10/11 x64:

```powershell
========================================================================================
Test Suite                                         Passed    Failed    Duration
========================================================================================
packages/windows-parity/tests/WindowsUiObserver        9         0         23ms
packages/windows-parity/tests/AnnotationStore          6         0         82ms
packages/windows-parity/tests/TargetPreservation       2         0         40ms
packages/windows-parity/tests/WindowsGhidraCaps        7         0         13ms
packages/windows-parity/tests/WindowsUiRealInteg       1         0       7040ms
src/windows/WindowsUiObservation.test                  2         0         12ms
src/windows/WindowsAnnotationStore.test                2         0         21ms
src/windows/WindowsNativeLoader.test                  22         0         17ms
src/windows/WindowsOwnedProcess.test                  21         0        145ms
src/windows/WindowsPrivateRuntime.test                13         0       1181ms
src/ghidra/GhidraProviderCapabilities.test             3         0          7ms
src/ghidra/GhidraProvider.behavior.test              167         0       1120ms
src/native/NativeUiObservation.test                   34         0        750ms
----------------------------------------------------------------------------------------
TOTALS                                               289         0       10.45s
========================================================================================
```

### Static Analysis & Turborepo Gate:

- **`npm run check:fast`**: Ran Turborepo `typecheck` and `lint`:
  - `typecheck` (`tsc --noEmit`): **0 errors**
  - `lint` (`oxlint` + module boundary verification): **0 errors**

---

## 🚀 Quick Start & Usage

### 1. Run All Tests

```powershell
# Run standalone package tests
npx vitest run --root packages/windows-parity

# Run REA core Windows tests
npx vitest run src/windows
```

### 2. Observe a Windows UI Application

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
console.log("Nodes Found:", result.initial.nodes.length);
if (result.initial.screenshot) {
  console.log("Screenshot SHA-256:", result.initial.screenshot.sha256);
}
```

### 3. Persist Annotations Across Sessions

```typescript
import { AnnotationStore } from "@rea/windows-parity/persistence";

const store = new AnnotationStore("C:\\Users\\User\\.rea\\annotations");

// Annotate function
await store.annotateFunction(
  { path: "C:\\fixtures\\target.exe", sha256: "3333...3333" },
  "0x140001000",
  {
    name: "CoreDispatcher",
    comment: "Primary PE dispatch routine reverse engineered",
  },
);

// Reload in subsequent analysis session
const annotations = await store.load({
  path: "C:\\fixtures\\target.exe",
  sha256: "3333...3333",
});
console.log(annotations?.functions["0x140001000"].name); // "CoreDispatcher"
```

---

## 📄 License

MIT © [HARI KRISHNAN N](https://github.com/nharikrishnan1611) & REA Contributors.
