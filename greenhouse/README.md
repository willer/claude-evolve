# Evolve Greenhouse 🌱

Electron desktop dashboard for [claude-evolve](https://github.com/anthropics/claude-evolve)
workspaces — autostatus, come full circle. claude-evolve's terminal `autostatus`
begat the trading-strategies TUI dashboard, which begat Genome FleetView; this
brings the GUI back around to the evolutions themselves.

The fleet renders as a keyboard-first **list** (every launch starts here) or a
card **grid** (`v` to toggle, per-session) — one row/card per evolution
workspace (a directory with `evolution.csv`). A header selector picks the
theme: system / dark / light (persisted; Electron's nativeTheme drives the
CSS, so the terminal panel stays dark either way):

- **Health** — one chip per workspace: `ok` / `plateau` (>20 gens since the
  leader) / `failing` (<80% recent success) / `stuck` (running, CSV static
  >12h) / `error`, same thresholds as the autostatus TUI. Sparklines are
  colored by health so plateaued and erroring runs jump out.
- **Leader** — best candidate, score, description. Score is the sort default
  (the one cross-workspace comparable, same convention as the streamlit
  reports — CAGR-style numbers are timeframe-dependent so there's no sort on
  them).
- **Trend** — best score per generation sparkline
- **Run stats** — latest gen, gens since leader, 5-gen success rate,
  pending/complete/failed/running counts, CSV staleness
- **Session state** — working / waiting / **asking** (with a native
  notification), detected from tmux pane motion exactly like the TUI; asking
  sessions get one-key ✓1/✗2 answer buttons (tmux send-keys)

**Space** peeks full status for the selected workspace without leaving the
fleet: every leader ratio (Sharpe, Sortino, CAGR, MaxDD, win rate, pain, …),
the leader's **NAV-over-time chart** (out-of-sample walk-forward equity with
an underwater drawdown pane and year gridlines — big drawdowns and stalled
NAV at a glance), plus returns by year from the `return_YYYY` CSV columns.
**Enter** opens the detail view — the same NAV chart bigger, generation
table, per-year return bars, year-returns-by-generation chart — and
auto-attaches a live terminal when the session is running (click or ⏎ to
focus it; ⌘esc backs out). The hint bar at the bottom lists all keys.

NAV data comes from `<workspace>/equity/<candidate-id>.csv`, written by the
trading-strategies evaluator (since 2026-06-11) for every successfully
evaluated candidate; leaders evaluated before then show an honest
"no artifact" note until a new leader lands.

Start/stop evolutions (detached tmux sessions running `claude` + the `/evolve`
skill) and attach a live terminal in-app. Sessions are tmux's — they share the
`evolve-<dir>` naming with the trading-strategies `autostatus` TUI, so both
tools see and can adopt each other's runs, and everything survives app quit.

## Run

```bash
npm install && npm run rebuild-native   # once (node-pty ↔ Electron ABI)
npm start                               # build + launch
npm test                                # vitest (core/, Electron-free)
npm run typecheck
```

First launch scans `~/GitHub/trading-strategies` for workspaces; configure
roots via the ⚙ button (any directory whose subdirectories contain
`evolution.csv`).

## Docs

- `docs/PLAN.md` — tracker
- `WEBTESTS.md` — UI verification (EG_SHOT screenshot harness)
