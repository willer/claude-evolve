import { describe, expect, it } from 'vitest';

import { NEWLINE_SEQ, PANE_STATE_FORMAT, pageUpAction, parsePaneState, terminalKeyOverride } from './terminalKeys';

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

describe('PageUp interception', () => {
  it('routes an unmodified PageUp keydown to main (pageUp), sending nothing itself', () => {
    expect(terminalKeyOverride(key({ key: 'PageUp' }))).toEqual({ send: null, pageUp: true });
  });

  it('swallows the keypress/keyup of PageUp', () => {
    expect(terminalKeyOverride(key({ type: 'keypress', key: 'PageUp' }))).toEqual({ send: null });
    expect(terminalKeyOverride(key({ type: 'keyup', key: 'PageUp' }))).toEqual({ send: null });
  });

  it('leaves modified PageUp and PageDown to xterm', () => {
    expect(terminalKeyOverride(key({ key: 'PageUp', shiftKey: true }))).toBeNull();
    expect(terminalKeyOverride(key({ key: 'PageUp', metaKey: true }))).toBeNull();
    expect(terminalKeyOverride(key({ key: 'PageDown' }))).toBeNull();
  });
});

describe('pageUpAction', () => {
  it('enters tmux copy-mode a page up when claude draws in the normal screen', () => {
    expect(pageUpAction({ alternateOn: false, inMode: false })).toBe('copy-mode');
  });

  it('forwards PageUp to the app in the alternate screen (fullscreen claude pages itself)', () => {
    expect(pageUpAction({ alternateOn: true, inMode: false })).toBe('send-key');
  });

  it('forwards PageUp while already in copy-mode (copy-mode pages on its own binding)', () => {
    expect(pageUpAction({ alternateOn: false, inMode: true })).toBe('send-key');
    expect(pageUpAction({ alternateOn: true, inMode: true })).toBe('send-key');
  });
});

describe('parsePaneState', () => {
  it('asks tmux for alternate_on and pane_in_mode', () => {
    expect(PANE_STATE_FORMAT).toBe('#{alternate_on} #{pane_in_mode}');
  });

  it('parses display-message output', () => {
    expect(parsePaneState('0 0\n')).toEqual({ alternateOn: false, inMode: false });
    expect(parsePaneState('1 0')).toEqual({ alternateOn: true, inMode: false });
    expect(parsePaneState('0 1\n')).toEqual({ alternateOn: false, inMode: true });
  });

  it('throws on output it cannot read instead of guessing', () => {
    expect(() => parsePaneState('')).toThrow();
    expect(() => parsePaneState('1')).toThrow();
    expect(() => parsePaneState('x y')).toThrow();
  });
});
