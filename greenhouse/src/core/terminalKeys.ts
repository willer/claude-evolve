// Key overrides for the embedded xterm (pure: tested in terminalKeys.test.ts).
// Shift+Enter (newline) and PageUp (scroll back) are overridden.
//
// AIDEV-NOTE: xterm.js encodes Shift+Enter as a bare CR, identical to Enter, so
// claude submits instead of starting a new line. Sending the kitty CSI-u form
// (ESC[13;2u) does not help either: tmux (extended-keys on) downgrades it to a
// plain CR for a pane app that hasn't asked for extended keys — verified with a
// raw-mode probe behind a real tmux client. ESC+CR (meta-Enter) passes through
// tmux byte-for-byte and claude's composer treats it as "insert newline".

export const NEWLINE_SEQ = '\x1b\r';

export interface KeyLike {
  type: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

/** null → let xterm handle the key normally. Otherwise xterm must NOT handle it
 *  (custom key handler returns false) and `send`, when non-null, is written to
 *  the session instead; `pageUp` asks main to page the session up (see
 *  pageUpAction). keypress/keyup of an overridden key are swallowed too, so
 *  xterm can't emit its own bytes alongside ours. */
export function terminalKeyOverride(e: KeyLike): { send: string | null; pageUp?: true } | null {
  if (e.isComposing) return null;
  const mods = e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
  if (e.key === 'PageUp' && !mods) {
    return e.type === 'keydown' ? { send: null, pageUp: true } : { send: null };
  }
  if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
  return { send: e.type === 'keydown' ? NEWLINE_SEQ : null };
}

// AIDEV-NOTE: PageUp needs the pane's state, which only tmux knows. Claude in
// the normal screen leaves its transcript in tmux pane history, and nothing in
// the pane pages it — so PageUp there enters copy-mode a page up (`copy-mode -e
// -u`; -e leaves copy-mode when PageDown/wheel reaches the bottom). In the
// alternate screen (fullscreen claude) or already in copy-mode, the key is
// forwarded unchanged and the app / copy-mode binding pages. PageDown is never
// intercepted: in copy-mode tmux pages down, otherwise there is nothing below.

export const PANE_STATE_FORMAT = '#{alternate_on} #{pane_in_mode}';

export interface PaneState {
  alternateOn: boolean;
  inMode: boolean;
}

/** Parse `display-message -p PANE_STATE_FORMAT` output. Throws on anything
 *  else rather than guessing a state. */
export function parsePaneState(out: string): PaneState {
  const m = /^([01]) ([01])$/.exec(out.trim());
  if (!m) throw new Error(`unreadable tmux pane state: ${JSON.stringify(out)}`);
  return { alternateOn: m[1] === '1', inMode: m[2] === '1' };
}

export function pageUpAction(s: PaneState): 'copy-mode' | 'send-key' {
  return !s.alternateOn && !s.inMode ? 'copy-mode' : 'send-key';
}
