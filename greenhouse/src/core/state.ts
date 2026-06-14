// Pane-state classification + launch constants, shared vocabulary with
// trading-strategies/autostatus (the TUI this app replaces).

import type { Activity } from './types';

// Footer text Claude shows ONLY in an interactive selection dialog — a
// question (AskUserQuestion) or a permission prompt. Absent from both the idle
// composer and the working spinner, so it's a clean "asking" signal.
export const ASKING_MARKERS = ['Esc to cancel', 'Do you want to proceed', '❯ 1.'];

/** Classify a live session pane: asking (dialog footer present), waiting
 *  (byte-static vs previous capture), else working. Build-agnostic by design —
 *  pane *motion* instead of fragile working-verb strings. */
export function classifyPane(
  text: string | null,
  prevHash: number | null,
): { activity: Activity; hash: number | null } {
  if (text === null) return { activity: 'working', hash: prevHash }; // unreadable → assume busy
  const h = hashText(text);
  if (ASKING_MARKERS.some((m) => text.includes(m))) return { activity: 'asking', hash: h };
  if (prevHash !== null && prevHash === h) return { activity: 'waiting', hash: h };
  return { activity: 'working', hash: h };
}

export function hashText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** tmux session name for a workspace dir — same scheme as the TUI, so both
 *  tools see (and can adopt) each other's running evolutions. */
export function sessionName(dir: string): string {
  return `evolve-${dir}`;
}

/** tmux session name for the adhoc claude session in a workspace dir — a plain
 *  interactive claude (NOT told to evolve), run alongside the evolution. This
 *  is a greenhouse-only concept (the TUI knows nothing of it), so it gets its
 *  own `adhoc-` prefix and never collides with the shared `evolve-` scheme. */
export function adhocSessionName(dir: string): string {
  return `adhoc-${dir}`;
}

// Evolution launch: claude running the /evolve skill, pinned to Opus at xhigh
// effort. Always forced into auto permission mode (operator decision
// 2026-06-12): rare prompts that still stop the session surface as ASKING
// (native notification; attach and answer in the terminal — the CLI does its
// own question asking). (Was Fable until 2026-06-12, when access was withdrawn.)
export const EVOLVE_PROMPT = 'run the /evolve skill';
export const EVOLVE_ARGS = ['--model', 'opus', '--effort', 'xhigh', '--permission-mode', 'auto'];

// Adhoc launch: a plain `claude` in the workspace dir — no model pin, no prompt,
// default permission mode. It's a scratch session to poke at the workspace by
// hand while evolution runs; you type whatever you want once attached.
export const ADHOC_ARGS: string[] = [];

// Repo-level tool scripts (trading-strategies): launched in their own tmux
// sessions, attachable like evolutions. Shown only when the executable exists
// in a configured root.
export const TOOLS = ['inference-all', 'backtest-all'] as const;

export function toolSessionName(key: string): string {
  return `greenhouse-${key}`;
}
