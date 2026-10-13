// Key overrides for the embedded xterm (pure: tested in terminalKeys.test.ts).
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
 *  the session instead. keypress/keyup of an overridden key are swallowed too,
 *  so xterm can't emit its own CR alongside ours. */
export function terminalKeyOverride(e: KeyLike): { send: string | null } | null {
  if (e.isComposing) return null;
  if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
  return { send: e.type === 'keydown' ? NEWLINE_SEQ : null };
}
