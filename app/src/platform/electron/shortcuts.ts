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

// The tables write a key press as `Modifiers+Key`: the modifiers in the order Ctrl, Alt,
// Shift, Cmd (the meta key: Command on macOS, Windows or Super elsewhere), then the key as
// `KeyboardEvent.key` names it, letters in upper case. The browser process sees each key
// before the page and cannot tell whether a text field has focus, so no shortcut may be a
// key that edits text.

/**
 * macOS. Cmd+Left and Cmd+Right are left out on purpose: they move the caret to the start
 * and the end of a line. Cmd+Tab belongs to the app switcher of the system.
 */
const macShortcuts = new Map<string, WindowCommand>([
  ['Cmd+T', 'tab.new'],
  ['Cmd+W', 'tab.close'],
  ['Shift+Cmd+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Alt+Cmd+ArrowRight', 'tab.next'],
  ['Shift+Cmd+]', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Alt+Cmd+ArrowLeft', 'tab.previous'],
  ['Shift+Cmd+[', 'tab.previous'],
  ['Cmd+R', 'page.reload'],
  // Other browsers reload without the cache here; there is no such command yet.
  ['Shift+Cmd+R', 'page.reload'],
  ['Cmd+[', 'page.back'],
  ['Cmd+]', 'page.forward'],
  ['Cmd+L', 'omnibox.focus'],
]);

/**
 * Windows and Linux. No shortcut combines Ctrl and Alt: Windows reports AltGr, which types
 * characters on many layouts, as Ctrl+Alt. The Back and Forward keys of some keyboards
 * arrive as key presses.
 */
const pcShortcuts = new Map<string, WindowCommand>([
  ['Ctrl+T', 'tab.new'],
  ['Ctrl+W', 'tab.close'],
  ['Ctrl+F4', 'tab.close'],
  ['Ctrl+Shift+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Ctrl+PageDown', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Ctrl+PageUp', 'tab.previous'],
  ['F5', 'page.reload'],
  ['Ctrl+R', 'page.reload'],
  // Other browsers reload without the cache here; there is no such command yet.
  ['Ctrl+F5', 'page.reload'],
  ['Shift+F5', 'page.reload'],
  ['Ctrl+Shift+R', 'page.reload'],
  ['Alt+ArrowLeft', 'page.back'],
  ['BrowserBack', 'page.back'],
  ['Alt+ArrowRight', 'page.forward'],
  ['BrowserForward', 'page.forward'],
  ['Ctrl+L', 'omnibox.focus'],
  ['Alt+D', 'omnibox.focus'],
  ['F6', 'omnibox.focus'],
]);

/**
 * Maps a key press to a window command. The default bindings follow the conventions of
 * each system; customizable shortcuts replace these tables in a later module.
 * @param input - The key event.
 * @param platform - `process.platform`.
 */
export function commandForInput(input: Input, platform: string): WindowCommand | undefined {
  // While an input method composes text, its keys belong to it: Japanese input methods,
  // for example, convert the text with F6 to F10 and Ctrl+T.
  if (input.type !== 'keyDown' || input.isComposing) {
    return undefined;
  }
  const mac = platform === 'darwin';
  return (mac ? macShortcuts : pcShortcuts).get(shortcutOf(input, mac));
}

/** Writes a key press in the notation of the tables. */
function shortcutOf(input: Input, mac: boolean): string {
  let { key, alt, shift } = input;
  // A letter, or a vowel sign, which Devanagari layouts type on some letter keys.
  const letter = /^[\p{L}\p{M}]$/u.test(key);
  if (/^[a-z]$/i.test(key)) {
    key = key.toUpperCase();
  } else if (letter && /^Key[A-Z]$/.test(input.code)) {
    // A layout for another script, such as Cyrillic or Devanagari: as in other browsers,
    // Ctrl+T is the key that carries the T on a Latin keyboard.
    key = input.code.slice(3);
  } else if (mac && letter && !/\p{Script=Latin}/u.test(key) && input.code.startsWith('Bracket')) {
    // The same for Cmd+[ and Cmd+] where a layout for another script, such as Russian or
    // Arabic, types letters on these keys. Latin layouts type brackets, with Option if need
    // be, so German keeps Cmd+ü on the key that has [ in English.
    key = input.code === 'BracketLeft' ? '[' : ']';
  } else if (mac && /^[[\]{}]$/.test(key)) {
    // Where a layout needs Option, and maybe Shift, to type a bracket, both belong to the
    // character. A brace is a bracket with Shift.
    if (alt) shift = false;
    alt = false;
    if (key === '{' || key === '}') {
      shift = true;
      key = key === '{' ? '[' : ']';
    }
  }
  const control = input.control ? 'Ctrl+' : '';
  const meta = input.meta ? 'Cmd+' : '';
  return `${control}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${meta}${key}`;
}
