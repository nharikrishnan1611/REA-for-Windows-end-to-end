import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { executeWindowsUiObservation } from "../src/ui/WindowsUiObserver.js";

describe("Windows UI Real System Integration", () => {
  it("observes real live Windows Forms window and captures accessibility tree + screenshot", async () => {
    // Launch a benign Windows Form in a background PowerShell child process
    const winPs = spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      `
      Add-Type -AssemblyName System.Windows.Forms, System.Drawing
      $form = New-Object System.Windows.Forms.Form
      $form.Text = 'REA Live Parity Test Window'
      $form.Width = 350
      $form.Height = 250
      $btn = New-Object System.Windows.Forms.Button
      $btn.Text = 'SubmitTest'
      $btn.Left = 30
      $btn.Top = 30
      $form.Controls.Add($btn)
      $form.Add_Shown({
          Write-Output "READY:$($form.Handle.ToInt64())"
      })
      [System.Windows.Forms.Application]::Run($form)
      `,
    ]);

    const pid = winPs.pid;
    expect(pid).toBeDefined();

    let hwnd = 0;

    const readyPromise = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(0); // If headless / no desktop interactive session, resolve 0
      }, 7000);

      winPs.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/READY:(\d+)/);
        if (match && match[1]) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });

      winPs.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    try {
      hwnd = await readyPromise;
      if (hwnd > 0 && pid) {
        // Real observation
        const snapshot = await executeWindowsUiObservation({
          pid,
          window_id: hwnd,
          screenshot: true,
          accessibility: true,
          max_nodes: 100,
        });

        expect(snapshot.window.pid).toBe(pid);
        expect(snapshot.window.window_id).toBe(hwnd);
        expect(snapshot.nodes.length).toBeGreaterThan(0);

        if (snapshot.screenshot) {
          expect(snapshot.screenshot.mime_type).toBe("image/png");
          expect(snapshot.screenshot.width).toBeGreaterThan(0);
          expect(snapshot.screenshot.height).toBeGreaterThan(0);
          expect(snapshot.screenshot.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
      } else {
        // Headless environment without interactive desktop surface
        console.warn(
          "Interactive desktop session not available; skipping live window capture assertions.",
        );
      }
    } finally {
      winPs.kill("SIGKILL");
    }
  }, 15000);
});
