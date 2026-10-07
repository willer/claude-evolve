import { describe, expect, it } from 'vitest';

import { NEWLINE_SEQ, terminalKeyOverride } from './terminalKeys';

const key = (over: Partial<Parameters<typeof terminalKeyOverride>[0]> = {}) => ({
  type: 'keydown',
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  ...over,
});

describe('terminalKeyOverride', () => {
  it('maps Shift+Enter to ESC+CR, the newline sequence tmux forwards intact', () => {
    expect(NEWLINE_SEQ).toBe('\x1b\r');
    expect(terminalKeyOverride(key({ shiftKey: true }))).toEqual({ send: '\x1b\r' });
  });

  it('swallows the keypress/keyup of Shift+Enter so xterm does not also send CR', () => {
    expect(terminalKeyOverride(key({ type: 'keypress', shiftKey: true }))).toEqual({ send: null });
    expect(terminalKeyOverride(key({ type: 'keyup', shiftKey: true }))).toEqual({ send: null });
  });

  it('leaves plain Enter to xterm (submits)', () => {
    expect(terminalKeyOverride(key())).toBeNull();
  });

  it('leaves other modified Enters and other keys alone', () => {
    expect(terminalKeyOverride(key({ shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(terminalKeyOverride(key({ shiftKey: true, metaKey: true }))).toBeNull();
    expect(terminalKeyOverride(key({ shiftKey: true, altKey: true }))).toBeNull();
    expect(terminalKeyOverride(key({ key: 'a', shiftKey: true }))).toBeNull();
  });

  it('does not intercept Enter while an IME composition is in progress', () => {
    expect(terminalKeyOverride(key({ shiftKey: true, isComposing: true }))).toBeNull();
  });
});
