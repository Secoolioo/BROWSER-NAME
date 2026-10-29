import { Translator, pickLanguage } from '../i18n/i18n.ts';
import { AppShell } from './app-shell.ts';
import { ShellBridge } from './bridge.ts';

// The shell's own code starts here, after its imports; the self-test reports it as
// `page.script`.
performance.mark('script');
const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
customElements.define('app-shell', AppShell);
const shell = new AppShell();
shell.bridge = new ShellBridge(window.bridge);
shell.i18n = i18n;
document.body.append(shell);
