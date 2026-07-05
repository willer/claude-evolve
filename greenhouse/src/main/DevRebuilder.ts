// Dev convenience: when a packaged greenhouse runs from inside its own source
// tree, watch src/ and silently re-package the .app whenever the source
// changes, so quitting and relaunching from the Dock always lands on the latest
// build.
//
// Why re-package (not just `npm run build`): the running .app embeds its own
// dist/ at package time — a bare build never reaches it. The only thing a Dock
// relaunch sees is a fresh electron-builder output. We drive `npm run package`
// (build + electron-builder --mac dir, deliberately NO `npm install`) after a
// quiet period following edits, one build at a time, and log to a file — never
// a GUI prompt, since this is meant to be invisible.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Only these extensions kick off a repackage; editor swap/temp files are
// ignored so a `:w` in vim (which churns dot-prefixed / `~`-suffixed files)
// doesn't trigger spurious builds.
const SOURCE_RE = /\.(ts|tsx|html|css)$/;

export class DevRebuilder {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private building = false;
  private dirty = false; // edits landed while a build was in flight
  private stopped = false;
  private readonly logPath: string;

  /**
   * @param sourceDir greenhouse source dir (from resolveDevSourceDir)
   * @param logDir    where to append dev-rebuild.log (app userData)
   * @param quietMs   idle window after the last edit before rebuilding
   */
  constructor(
    private readonly sourceDir: string,
    logDir: string,
    private readonly quietMs = 5000,
  ) {
    this.logPath = path.join(logDir, 'dev-rebuild.log');
  }

  start(): void {
    const srcDir = path.join(this.sourceDir, 'src');
    try {
      this.watcher = fs.watch(srcDir, { recursive: true }, (_evt, filename) =>
        this.onChange(filename),
      );
    } catch (err) {
      this.log(`could not watch ${srcDir} (${String(err)}) — auto-rebuild disabled`);
      return;
    }
    this.log(`watching ${srcDir} — will re-package the .app on source changes`);
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  private onChange(filename: string | Buffer | null): void {
    if (this.stopped) return;
    if (filename != null) {
      const base = path.basename(filename.toString());
      if (base.startsWith('.') || base.endsWith('~')) return; // editor swap/temp files
      if (!SOURCE_RE.test(base)) return; // non-source change (e.g. a stray artifact)
    }
    if (this.building) {
      this.dirty = true; // fold into one follow-up build after the current finishes
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rebuild(), this.quietMs);
  }

  private rebuild(): void {
    this.debounceTimer = null;
    if (this.stopped || this.building) return;
    this.building = true;
    this.dirty = false;
    this.log('source changed → npm run package …');
    const started = Date.now();

    // spawn resolves `npm` against PATH (normalized in main.ts to include
    // /opt/homebrew/bin for Dock launches). `npm run package` internally routes
    // electron-builder through scripts/with-node22.sh, so the node version is
    // handled there. Output is captured for the log, not surfaced to the user.
    const child = spawn('npm', ['run', 'package'], {
      cwd: this.sourceDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const tail: string[] = [];
    const capture = (b: Buffer): void => {
      tail.push(b.toString());
      if (tail.length > 200) tail.splice(0, tail.length - 200); // keep only the last chunks
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const done = (ok: boolean, detail: string): void => {
      this.building = false;
      const secs = Math.round((Date.now() - started) / 1000);
      if (ok) this.log(`✅ repackaged in ${secs}s — relaunch from the Dock for the latest`);
      else this.log(`✗ package failed after ${secs}s: ${detail}\n${tail.join('')}`);
      // Edits that arrived mid-build queue exactly one more pass.
      if (this.dirty && !this.stopped) this.onChange(null);
    };

    child.on('error', (err) => done(false, String(err)));
    child.on('close', (code) => done(code === 0, `exit ${code}`));
  }

  private log(msg: string): void {
    // Visible in the terminal when launched via `npm start`, silent to the GUI.
    console.log(`[dev-rebuild] ${msg}`);
    try {
      fs.appendFileSync(this.logPath, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      /* logging is best-effort */
    }
  }
}
