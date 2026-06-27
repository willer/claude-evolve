// tmux owns the evolution sessions (durable across app quit); node-pty is only
// the attach transport. Same division of labor as Genome FleetView.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as pty from 'node-pty';

import {
  ADHOC_ARGS,
  EVOLVE_ARGS,
  EVOLVE_PROMPT,
  adhocSessionName,
  sessionName,
  toolSessionName,
} from '../core/state';

const execFileP = promisify(execFile);

export interface AttachHandle {
  onData(cb: (data: string) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void; // kills the tmux CLIENT only; the session survives
  onClose(cb: () => void): void;
}

// Global tmux options, idempotent to re-assert per spawn/attach:
// - extended-keys: forward Shift+Enter etc. (newline in claude's composer)
// - window-size latest: co-attaching alongside the operator's own terminal
//   must not shrink the session in both places.
const SERVER_OPTS: Array<[string, string, string]> = [
  ['-g', 'extended-keys', 'on'],
  ['-ga', 'terminal-features', 'xterm*:extkeys'],
  ['-g', 'window-size', 'latest'],
];

async function tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileP('tmux', args);
  return stdout;
}

async function assertServerOpts(): Promise<void> {
  for (const [flag, opt, val] of SERVER_OPTS) {
    await tmux('set-option', flag, opt, val).catch(() => {});
  }
}

function isNoServerStderr(stderr: string): boolean {
  return /no server running|error connecting to/.test(stderr);
}

export class SessionHost {
  /** Names of all live tmux sessions (not just ours). */
  async list(): Promise<Set<string>> {
    try {
      const out = await tmux('list-sessions', '-F', '#{session_name}');
      return new Set(out.split('\n').filter(Boolean));
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      if (isNoServerStderr(stderr)) return new Set();
      throw err; // EMFILE/ENOENT must surface, not read as "empty fleet"
    }
  }

  /** Start an evolution: detached session in the workspace dir, then type the
   *  claude command with a trailing `exit` — when claude ends (quit or crash)
   *  the shell exits, the session dies, and the next poll shows it stopped. */
  async startEvolution(dir: string, workspacePath: string): Promise<string> {
    await assertServerOpts();
    const sess = sessionName(dir);
    await tmux('new-session', '-d', '-s', sess, '-x', '220', '-y', '50', '-c', workspacePath);
    const cmd = `claude ${EVOLVE_ARGS.join(' ')} ${shellQuote(EVOLVE_PROMPT)}; exit`;
    await tmux('send-keys', '-t', sess, cmd, 'Enter');
    return sess;
  }

  /** Start an adhoc claude session: detached session in the workspace dir, then
   *  type a plain `claude` (no /evolve prompt). Same shell-stays-alive pattern
   *  as evolutions — when claude exits the shell exits and the session dies. */
  async startAdhoc(dir: string, workspacePath: string): Promise<string> {
    await assertServerOpts();
    const sess = adhocSessionName(dir);
    await tmux('new-session', '-d', '-s', sess, '-x', '220', '-y', '50', '-c', workspacePath);
    const cmd = `claude${ADHOC_ARGS.length ? ' ' + ADHOC_ARGS.join(' ') : ''}; exit`;
    await tmux('send-keys', '-t', sess, cmd, 'Enter');
    return sess;
  }

  /** Start a repo-level tool script (./inference-all, ./backtest-all) in its
   *  own detached session in the repo root — same shell-stays-alive pattern
   *  as evolutions, so the pane is inspectable after the script exits. */
  async startTool(key: string, root: string): Promise<string> {
    await assertServerOpts();
    const sess = toolSessionName(key);
    await tmux('new-session', '-d', '-s', sess, '-x', '220', '-y', '50', '-c', root);
    await tmux('send-keys', '-t', sess, `./${key}`, 'Enter');
    return sess;
  }

  attach(id: string, cols: number, rows: number): AttachHandle {
    void assertServerOpts(); // adopted sessions never went through start
    const proc = pty.spawn('tmux', ['attach', '-t', id], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env as Record<string, string>,
    });
    return {
      onData: (cb) => proc.onData(cb),
      write: (data) => proc.write(data),
      resize: (c, r) => {
        try {
          proc.resize(c, r);
        } catch {
          /* racing a dead client is fine */
        }
      },
      close: () => proc.kill(),
      onClose: (cb) => proc.onExit(() => cb()),
    };
  }

  /** Nudge a stuck session: Esc (clear any half-typed prompt / dismiss a
   *  dialog), then type "continue please" and Enter. Used by the 'stuck' badge
   *  when a session stalled on a hard wall (spend/usage limit) the operator has
   *  since cleared. Small delays let the TUI process each step (Esc must land
   *  before the text, the text before Enter). */
  async unstick(id: string): Promise<void> {
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await tmux('send-keys', '-t', id, 'Escape');
    await pause(250);
    await tmux('send-keys', '-t', id, '-l', 'continue please');
    await pause(150);
    await tmux('send-keys', '-t', id, 'Enter');
  }

  async capture(id: string): Promise<string | null> {
    try {
      return await tmux('capture-pane', '-p', '-t', id);
    } catch {
      return null;
    }
  }

  kill(id: string): void {
    execFile('tmux', ['kill-session', '-t', id], () => {});
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
