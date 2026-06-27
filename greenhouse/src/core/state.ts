// Pane-state classification + launch constants, shared vocabulary with
// trading-strategies/autostatus (the TUI this app replaces).

import type { Activity } from './types';

// Footer text Claude shows ONLY in an interactive selection dialog — a
// question (AskUserQuestion) or a permission prompt. Absent from both the idle
// composer and the working spinner, so it's a clean "asking" signal.
export const ASKING_MARKERS = ['Esc to cancel', 'Do you want to proceed', '❯ 1.'];

// A session can sit byte-static at an idle composer while its OWN background
// work — shells or subagents — is still churning. The /evolve omnibus does
// exactly this: it spawns a pool of background worker subagents and returns the
// main pane to the composer while they run, so "static composer" does NOT mean
// "waiting on you". These status-line fragments prove background work is in
// flight and override the byte-static 'waiting' verdict. This build does not
// print "esc to interrupt" (so we can't key off the spinner) — we read the
// shell/agent counters instead. Verified against live evolve panes 2026-06-17.
//
// CRITICAL: these are matched ONLY against the live footer (see liveFooter),
// never the whole pane. When a session stops, its last live spinner line ("· 2
// shells still running") gets pushed up into scrollback by later output ("came
// to rest" etc.) and FREEZES there byte-static — matching the whole pane would
// pin a dead session to 'working' forever. Verified against the spend-limited
// 1d-soxl-inv pane 2026-06-20 (idle "Cooked for 0s" footer, stale "N shells"
// lines above it).
export const BUSY_MARKERS: RegExp[] = [
  /\b\d+ shells?\b/, //             footer "· 2 shells ·" / spinner "1 shell still running"
  /\b\d+ background agents?\b/, //  spinner "Waiting for 2 background agents to finish"
  /↓\s*[\d.]+k? tokens/, //         a running agent-fleet row, e.g. "◯ evolve-worker-1 … ↓ 32.0k tokens"
];

// A byte-static pane that carries one of these is not a benign idle composer —
// it's a session that hit a hard wall and needs a human (raise the cap, top up
// credits) before it can do anything. Surfaced as 'stuck' (distinct from a
// plain 'waiting' idle composer) so the fleet flags + notifies it. Checked
// against the WHOLE pane, since the error text lives in scrollback above the
// now-idle footer. Seen on 1d-soxl-inv 2026-06-20 ("hit your org's monthly
// spend limit · run /usage-credits …").
export const STUCK_MARKERS: RegExp[] = [
  /\b(monthly )?spend limit\b/i,
  /\busage limit\b/i,
  /\/usage-credits\b/,
  /\bcredit balance is too low\b/i,
];

// The live status/spinner line has the shape "<glyph> <Verb> for <duration>"
// ("✻ Cooked for 0s", "✻ Worked for 3m 33s · 2 shells still running"). It sits
// just above the composer, and any earlier spinner snapshots have scrolled up
// into history — so the LAST line of this shape, plus everything below it, is
// the live footer. Busy markers only count here. The "X for <duration>" idiom
// is structural (not a churning verb string), so this stays build-agnostic.
const SPINNER_LINE = /\b\w+ for \d+\s*[hms]\b/;

/** The live footer band: from the last spinner-shaped line to the end. Falls
 *  back to the whole text when no spinner line is present (e.g. the agent-fleet
 *  view, whose live token rows are the only busy signal). */
function liveFooter(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SPINNER_LINE.test(lines[i])) return lines.slice(i).join('\n');
  }
  return text;
}

/** Classify a live session pane:
 *   - asking: an interactive dialog footer is present.
 *   - working: background shells/subagents are live in the footer, or the pane
 *     is moving.
 *   - stuck:  byte-static AND a hard-wall marker (spend/usage limit) is present
 *     — needs a human, not just idle.
 *   - waiting: byte-static with nothing in flight — a true idle composer.
 *  Build-agnostic by design — pane *motion* plus the busy/stuck counters, never
 *  fragile working-verb strings. */
export function classifyPane(
  text: string | null,
  prevHash: number | null,
): { activity: Activity; hash: number | null } {
  if (text === null) return { activity: 'working', hash: prevHash }; // unreadable → assume busy
  const h = hashText(text);
  if (ASKING_MARKERS.some((m) => text.includes(m))) return { activity: 'asking', hash: h };
  // Busy markers are scoped to the live footer so stale "N shells" / token rows
  // frozen in scrollback can't pin a dead session to 'working'.
  if (BUSY_MARKERS.some((re) => re.test(liveFooter(text)))) return { activity: 'working', hash: h };
  if (prevHash !== null && prevHash === h) {
    // Byte-static: idle. Distinguish a hard-wall stop (needs a human) from a
    // benign idle composer.
    if (STUCK_MARKERS.some((re) => re.test(text))) return { activity: 'stuck', hash: h };
    return { activity: 'waiting', hash: h };
  }
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

// Evolution launch: claude driven by a /goal that runs /evolve until at least 2
// generations pass with no improvement (so the session self-terminates on a
// plateau instead of looping forever), pinned to Opus at xhigh effort. Always
// forced into auto permission mode (operator decision
// 2026-06-12): rare prompts that still stop the session surface as ASKING
// (native notification; attach and answer in the terminal — the CLI does its
// own question asking). (Was Fable until 2026-06-12, when access was withdrawn.)
export const EVOLVE_PROMPT =
  "/goal run /evolve and keep evolving until there's at least 2 generations that show no improvement and you have no more ideas";
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
