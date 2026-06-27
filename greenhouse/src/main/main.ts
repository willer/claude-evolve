// Main process composition root: SessionHost + Poller + IPC. All logic lives
// in core/ and the main/ modules — this file only composes.

import { BrowserWindow, Notification, app, nativeTheme, screen } from 'electron';
import * as path from 'node:path';

import { Poller } from './Poller';
import { PrefsStore } from './prefsStore';
import { SessionHost } from './SessionHost';
import { SystemMetrics } from './SystemMetrics';
import { wireIpc } from './ipc';

// Dock launches inherit launchd's bare PATH — tmux/claude live in
// /opt/homebrew/bin. Normalize before any execFile/pty.spawn can run.
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];
process.env.PATH = [
  ...new Set([...(process.env.PATH ?? '').split(':').filter(Boolean), ...EXTRA_PATHS]),
].join(':');

// launchd exports no locale vars: a C-locale tmux mangles UTF-8 pane captures
// and spawned claude rendering.
if (!process.env.LANG && !process.env.LC_ALL) process.env.LANG = 'en_US.UTF-8';

// Unpackaged Electron defaults userData to a shared "Electron" dir — pin ours.
app.setName('evolve-greenhouse');
app.setPath('userData', path.join(app.getPath('appData'), 'evolve-greenhouse'));

let win: BrowserWindow | null = null;

// A saved frame is only usable if it still overlaps a connected display —
// otherwise a window restored onto a now-disconnected monitor lands offscreen
// and looks lost. Require a meaningful intersection with some display's work
// area; fall back to the default centered size when it fails.
function boundsOnScreen(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const ix = Math.max(0, Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x));
    const iy = Math.max(0, Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y));
    return ix >= 100 && iy >= 100; // at least a 100×100 patch is reachable
  });
}

function createWindow(prefs: PrefsStore): BrowserWindow {
  const saved = prefs.get().windowBounds;
  const usable = saved && boundsOnScreen(saved) ? saved : null;
  const w = new BrowserWindow({
    width: usable?.width ?? 1380,
    height: usable?.height ?? 880,
    ...(usable ? { x: usable.x, y: usable.y } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    title: 'Evolve Greenhouse',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (usable?.maximized) w.maximize();
  w.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Persist position/size reactively, debounced, on every geometry change —
  // NOT only on close. Quitting `npm start` with Ctrl+C (SIGINT) kills the
  // process without firing the window 'close' event, so a close-only save
  // silently loses the last layout; the same is true of a crash or force-quit.
  // getNormalBounds() returns the restored (un-maximized) frame, so a maximized
  // window still remembers where to land when next un-maximized.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const nb = w.getNormalBounds();
      prefs.set({ windowBounds: { ...nb, maximized: w.isMaximized() } });
    }, 400);
  };
  w.on('resize', persistBounds);
  w.on('move', persistBounds);
  w.on('maximize', persistBounds);
  w.on('unmaximize', persistBounds);
  // Flush synchronously on close so the final position lands even if it moved
  // within the debounce window before a clean quit.
  w.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    const nb = w.getNormalBounds();
    prefs.set({ windowBounds: { ...nb, maximized: w.isMaximized() } });
  });
  return w;
}

app.whenReady().then(() => {
  const prefs = new PrefsStore(path.join(app.getPath('userData'), 'prefs.json'));
  nativeTheme.themeSource = prefs.get().theme; // renderer CSS follows via prefers-color-scheme
  const host = new SessionHost();
  // EG_ROOTS (colon-separated) overrides the scanned roots without touching
  // saved prefs — used by WEBTESTS.md runs against synthetic workspaces.
  // Shared by the Poller AND ipc data lookups (backtest DB), so EG_ROOTS runs
  // never read the real repos.
  const testRoots = process.env.EG_ROOTS?.split(':').filter(Boolean);
  const effPrefs = () => (testRoots ? { ...prefs.get(), roots: testRoots } : prefs.get());
  const poller = new Poller(
    host,
    effPrefs,
    (rows, tools) => win?.webContents.send('fleet:update', { rows, tools }),
    (name, activity) => {
      const stuck = activity === 'stuck';
      new Notification({
        title: stuck ? `${name} is stuck` : `${name} is asking`,
        body: stuck
          ? 'The evolution hit a hard wall (spend/usage limit) and stalled — attach to clear it.'
          : 'The evolution session has a question or permission prompt — attach to answer.',
      }).show();
    },
  );

  wireIpc(() => win, host, poller, prefs, effPrefs);

  win = createWindow(prefs);
  win.on('closed', () => (win = null));

  poller.start(5000);

  // Host load (CPU/loadavg/memory) for the header gauges — its own faster cadence
  // than the 5s fleet poll, on a separate channel so it never re-renders the grid.
  const sys = new SystemMetrics();
  const sysTimer = setInterval(() => win?.webContents.send('system:update', sys.sample()), 2000);

  app.on('before-quit', () => {
    poller.stop();
    clearInterval(sysTimer);
  });

  if (process.env.EG_SHOT) devShots(process.env.EG_SHOT);
});

app.on('window-all-closed', () => app.quit());

// Screenshot verification harness (WEBTESTS.md): EG_SHOT=<dir> captures the
// list (default view), the Space peek popover, the tool page, the grid, the
// first workspace's detail view, and a chart enlarged in the zoom overlay, then
// quits. Read-only: never clicks action buttons. (Backtests are now part of the
// per-workspace detail view, not a standalone page.)
function devShots(dir: string): void {
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (name: string) => {
    const img = await win!.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name), img.toPNG());
  };
  const js = (code: string) => win!.webContents.executeJavaScript(code);
  const key = (k: string) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  setTimeout(async () => {
    // Window-bounds restore check: logs the frame the window launched with so
    // a seeded prefs.json windowBounds can be confirmed against it.
    console.log(`EG_SHOT bounds=${JSON.stringify(win!.getBounds())}`);
    await shot('list.png');
    // Both themes via nativeTheme only — doesn't touch the persisted pref.
    const saved = nativeTheme.themeSource;
    for (const t of ['light', 'dark'] as const) {
      nativeTheme.themeSource = t;
      await pause(500);
      await shot(`list-${t}.png`);
    }
    nativeTheme.themeSource = saved;
    await pause(500);
    // Scroll-reset regression: opening a detail view from a scrolled-down
    // list must land at the top, not inherit the list's scroll offset.
    await js(`window.scrollTo(0, 99999)`);
    const preY = await js(`window.scrollY`);
    await js(`document.querySelector('#list tr.row:last-of-type')?.click()`);
    await pause(800);
    const detailY = await js(`window.scrollY`);
    console.log(`EG_SHOT scroll-reset pre-click=${preY} detail=${detailY}`);
    await shot('detail-from-scrolled-list.png');
    await key('Escape');
    await pause(400);
    await key(' '); // peek popover for the selected row
    await pause(400);
    await shot('peek.png');
    await key('Escape');
    // Tool page: opening is read-only — it never presses ▶ Run, and attaches
    // only when the tool session already exists.
    await js(`document.querySelector('#tool-btns [data-tool]')?.click()`);
    await pause(800);
    await shot('tool.png');
    await key('Escape');
    await key('v'); // toggle to grid
    await pause(600);
    await shot('grid.png');
    await js(`document.querySelector('.card')?.click()`);
    await pause(1500);
    await shot('detail.png');
    // Click-to-enlarge: open the best-score sparkline in the zoom overlay (it
    // repaints at a larger size with a labeled min/max Y-axis gutter it omits at
    // tile size), capture, then close. The sparkline is always present (no
    // equity artifact needed), so this shot is workspace-agnostic.
    await js(`document.querySelector('#detail [data-chart="spark-gen"]')?.click()`);
    await pause(500);
    await shot('detail-zoom.png');
    await key('Escape');
    await pause(300);
    // NAV chart opens the interactive viewer (axes path: Y %-return gutter, the
    // start→end date range, the position pane when present). Full range first.
    // Present only when the leader has an equity artifact, so this shot can be
    // blank on artifact-less workspaces — verify on a trading root.
    await js(`document.querySelector('#detail [data-chart="nav-leader"]')?.click()`);
    await pause(500);
    await shot('detail-zoom-nav.png');
    // Drive the interactive zoom: + three times narrows the window about its
    // centre — the Y axis and the return/maxDD/Sharpe badge recompute to the
    // visible slice, proving it's a live chart, not a static enlarge.
    await js(
      `(() => { const b = document.querySelector('.nav-zoom-ctl [data-nz="in"]'); if (b) { b.click(); b.click(); b.click(); } })()`,
    );
    await pause(300);
    await shot('detail-zoom-nav-in.png');
    await key('Escape');
    await pause(300);
    // Focus-stability regression check: focus the attached terminal, span a
    // poll push, and confirm focus + scroll position survived the re-render.
    await js(`document.querySelector('.term-wrap textarea')?.focus()`);
    await pause(6500);
    const focused = await js(`!!(document.activeElement && document.activeElement.closest('.term-wrap'))`);
    const scrollY = await js(`window.scrollY`);
    console.log(`EG_SHOT focus-after-poll=${focused} scrollY=${scrollY}`);
    app.quit();
  }, 8000);
}
