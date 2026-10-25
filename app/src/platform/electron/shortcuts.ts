import type { Input } from 'electron';

/** Keyboard shortcuts the window handles itself, also while web content has focus. */
export type WindowCommand =
  | 'tab.new'
  | 'tab.close'
  | 'tab.reopen'
  | 'tab.next'
  | 'tab.previous'
  | 'page.reload'
  | 'page.back'
  | 'page.forward'
  | 'omnibox.focus';

/**
 * Maps a key press to a window command. The default bindings follow the platform
 * conventions; customizable shortcuts replace this table in a later module.
 * @param input - The key event.
 * @param platform - `process.platform`.
 */
export function commandForInput(input: Input, platform: string): WindowCommand | undefined {
  if (input.type !== 'keyDown') {
    return undefined;
  }
  const primary = platform === 'darwin' ? input.meta : input.control;
  const key = input.key.toLowerCase();
  if (primary && !input.alt) {
    if (key === 't') return input.shift ? 'tab.reopen' : 'tab.new';
    if (key === 'w') return 'tab.close';
    if (key === 'r') return 'page.reload';
    if (key === 'l') return 'omnibox.focus';
    if (key === 'tab') return input.shift ? 'tab.previous' : 'tab.next';
  }
  if (input.control && key === 'tab' && platform === 'darwin') {
    return input.shift ? 'tab.previous' : 'tab.next';
  }
  if (key === 'f5' && !input.alt) return 'page.reload';
  const historyModifier = platform === 'darwin' ? input.meta : input.alt;
  if (historyModifier && key === 'arrowleft') return 'page.back';
  if (historyModifier && key === 'arrowright') return 'page.forward';
  return undefined;
}
