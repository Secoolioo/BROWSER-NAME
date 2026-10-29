import type { Input } from 'electron';
import { describe, expect, it } from 'vitest';
import { commandForInput, type WindowCommand } from '../electron/shortcuts.ts';

/** A key press as `before-input-event` reports it. */
function press(key: string, details: Partial<Input> = {}): Input {
  return {
    type: 'keyDown',
    key,
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    location: 0,
    modifiers: [],
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...details,
  };
}

const ctrl = { control: true };
const ctrlShift = { control: true, shift: true };
const alt = { alt: true };
const cmd = { meta: true };
const cmdShift = { meta: true, shift: true };
const cmdOption = { meta: true, alt: true };

type Row = [label: string, input: Input, command: WindowCommand | undefined];

const windowsAndLinux: Row[] = [
  ['Ctrl+T', press('t', ctrl), 'tab.new'],
  ['Ctrl+W', press('w', ctrl), 'tab.close'],
  ['Ctrl+F4', press('F4', ctrl), 'tab.close'],
  ['Ctrl+Shift+T', press('T', ctrlShift), 'tab.reopen'],
  ['Ctrl+Tab', press('Tab', ctrl), 'tab.next'],
  ['Ctrl+Page Down', press('PageDown', ctrl), 'tab.next'],
  ['Ctrl+Shift+Tab', press('Tab', ctrlShift), 'tab.previous'],
  ['Ctrl+Page Up', press('PageUp', ctrl), 'tab.previous'],
  ['F5', press('F5'), 'page.reload'],
  ['Ctrl+F5', press('F5', ctrl), 'page.reload'],
  ['Shift+F5', press('F5', { shift: true }), 'page.reload'],
  ['Ctrl+R', press('r', ctrl), 'page.reload'],
  ['Ctrl+Shift+R', press('R', ctrlShift), 'page.reload'],
  ['Alt+Left', press('ArrowLeft', alt), 'page.back'],
  ['Alt+Right', press('ArrowRight', alt), 'page.forward'],
  ['the Back key', press('BrowserBack'), 'page.back'],
  ['the Forward key', press('BrowserForward'), 'page.forward'],
  ['Ctrl+L', press('l', ctrl), 'omnibox.focus'],
  ['Alt+D', press('d', alt), 'omnibox.focus'],
  ['F6', press('F6'), 'omnibox.focus'],
  ['Ctrl+T with Caps Lock', press('T', ctrl), 'tab.new'],
  ['Ctrl+T on a Cyrillic layout', press('е', { ...ctrl, code: 'KeyT' }), 'tab.new'],
  ['Ctrl+Shift+T on a Greek layout', press('Τ', { ...ctrlShift, code: 'KeyT' }), 'tab.reopen'],
  ['Ctrl+T on InScript, typing a vowel sign', press('ू', { ...ctrl, code: 'KeyT' }), 'tab.new'],
  ['Alt+D on InScript, typing the virama', press('्', { ...alt, code: 'KeyD' }), 'omnibox.focus'],
  ['Ctrl+W on AZERTY, where W is on the Z key', press('w', { ...ctrl, code: 'KeyZ' }), 'tab.close'],
  [
    'no Ctrl+Z on AZERTY, where Z is on the W key',
    press('z', { ...ctrl, code: 'KeyW' }),
    undefined,
  ],
  ['no AltGr+T, reported as Ctrl+Alt+T', press('t', { ...ctrl, ...alt, code: 'KeyT' }), undefined],
  ['no AltGr+Q typing @', press('@', { ...ctrl, ...alt, code: 'KeyQ' }), undefined],
  ['no AltGr+D typing Đ', press('Đ', { ...ctrl, ...alt, code: 'KeyD' }), undefined],
  ['no AltGr+L typing ł', press('ł', { ...ctrl, ...alt, code: 'KeyL' }), undefined],
  ['no AltGr+Left', press('ArrowLeft', { ...ctrl, ...alt }), undefined],
  ['no AltGr+Tab', press('Tab', { ...ctrl, ...alt }), undefined],
  ['no AltGr+F5', press('F5', { ...ctrl, ...alt }), undefined],
  ['no Ctrl+Left, which moves by word', press('ArrowLeft', ctrl), undefined],
  ['no Shift+Alt+Left', press('ArrowLeft', { ...alt, shift: true }), undefined],
  ['no Ctrl+Shift+Page Down', press('PageDown', ctrlShift), undefined],
  ['no Alt+F4, which closes the window', press('F4', alt), undefined],
  ['no Shift+F6', press('F6', { shift: true }), undefined],
  ['no Shift+Alt+D', press('D', { ...alt, shift: true }), undefined],
  ['no Windows key+T', press('t', cmd), undefined],
  ['no Ctrl+Windows key+T', press('t', { ...ctrl, ...cmd }), undefined],
  ['no Windows key+Left', press('ArrowLeft', cmd), undefined],
  ['no Windows key+[, which goes back on macOS', press('[', cmd), undefined],
  ['no T alone', press('t'), undefined],
];

const macOS: Row[] = [
  ['Cmd+T', press('t', cmd), 'tab.new'],
  ['Cmd+W', press('w', cmd), 'tab.close'],
  ['Cmd+Shift+T', press('T', cmdShift), 'tab.reopen'],
  ['Ctrl+Tab', press('Tab', ctrl), 'tab.next'],
  ['Ctrl+Shift+Tab', press('Tab', ctrlShift), 'tab.previous'],
  ['Cmd+Option+Right', press('ArrowRight', cmdOption), 'tab.next'],
  ['Cmd+Option+Left', press('ArrowLeft', cmdOption), 'tab.previous'],
  ['Cmd+Shift+], typing }', press('}', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+Shift+[, typing {', press('{', { ...cmdShift, code: 'BracketLeft' }), 'tab.previous'],
  ['Cmd+Shift+], reported as ]', press(']', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+R', press('r', cmd), 'page.reload'],
  ['Cmd+Shift+R', press('R', cmdShift), 'page.reload'],
  ['Cmd+[', press('[', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+]', press(']', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['Cmd+L', press('l', cmd), 'omnibox.focus'],
  ['Cmd+[ where [ needs Option', press('[', { ...cmdOption, code: 'Digit5' }), 'page.back'],
  ['Cmd+] where ] needs Option+Shift', press(']', { ...cmdOption, shift: true }), 'page.forward'],
  ['Cmd+{ where { needs Option', press('{', { ...cmdOption, code: 'Digit8' }), 'tab.previous'],
  ['Cmd+T on a Cyrillic layout', press('е', { ...cmd, code: 'KeyT' }), 'tab.new'],
  ['Cmd+[ on Russian, typing х', press('х', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+] on Russian, typing ъ', press('ъ', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['Cmd+Shift+] on Russian', press('Ъ', { ...cmdShift, code: 'BracketRight' }), 'tab.next'],
  ['Cmd+[ on Arabic, typing ج', press('ج', { ...cmd, code: 'BracketLeft' }), 'page.back'],
  ['Cmd+] on InScript, a nukta', press('़', { ...cmd, code: 'BracketRight' }), 'page.forward'],
  ['no Cmd+Option+[ on Russian', press('х', { ...cmdOption, code: 'BracketLeft' }), undefined],
  ['no Cmd+ü on German, on the [ key', press('ü', { ...cmd, code: 'BracketLeft' }), undefined],
  ['no Cmd++ on German, on the ] key', press('+', { ...cmd, code: 'BracketRight' }), undefined],
  ['no Cmd+Left, which moves the caret', press('ArrowLeft', cmd), undefined],
  ['no Cmd+Right, which moves the caret', press('ArrowRight', cmd), undefined],
  ['no Cmd+Shift+Left, which selects', press('ArrowLeft', cmdShift), undefined],
  ['no Option+Left, which moves by word', press('ArrowLeft', alt), undefined],
  ['no Cmd+Tab, the app switcher', press('Tab', cmd), undefined],
  ['no Cmd+Shift+Tab', press('Tab', cmdShift), undefined],
  ['no Cmd+Option+[ typing “', press('“', { ...cmdOption, code: 'BracketLeft' }), undefined],
  ['no Ctrl+T', press('t', ctrl), undefined],
  ['no Ctrl+Cmd+T', press('t', { ...ctrl, ...cmd }), undefined],
  ['no Ctrl+[', press('[', ctrl), undefined],
  ['no F5', press('F5'), undefined],
  ['no F6', press('F6'), undefined],
  ['no Option+D typing ∂', press('∂', { ...alt, code: 'KeyD' }), undefined],
  ['no Option+Right, which moves by word', press('ArrowRight', alt), undefined],
];

describe.each(['win32', 'linux'])('commandForInput on %s', (platform) => {
  it.each(windowsAndLinux)('%s', (_label, input, command) => {
    expect(commandForInput(input, platform)).toBe(command);
  });
});

describe('commandForInput on darwin', () => {
  it.each(macOS)('%s', (_label, input, command) => {
    expect(commandForInput(input, 'darwin')).toBe(command);
  });
});

describe.each(['darwin', 'win32', 'linux'])('commandForInput on %s', (platform) => {
  const newTab = press('t', platform === 'darwin' ? cmd : ctrl);

  it('acts on the key press, not on its release', () => {
    expect(commandForInput(newTab, platform)).toBe('tab.new');
    expect(commandForInput({ ...newTab, type: 'keyUp' }, platform)).toBeUndefined();
  });

  it('leaves keys to an input method that composes text', () => {
    expect(commandForInput({ ...newTab, isComposing: true }, platform)).toBeUndefined();
    expect(commandForInput(press('F6', { isComposing: true }), platform)).toBeUndefined();
    expect(commandForInput(press('Process', { isComposing: true }), platform)).toBeUndefined();
  });
});
