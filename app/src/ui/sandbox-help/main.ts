import { brand } from '../../shared/brand.ts';
import { Translator, isMessageKey, pickLanguage } from '../i18n/i18n.ts';

const bridge = window.bridge;
const i18n = new Translator(pickLanguage(navigator.languages));
document.documentElement.lang = i18n.language;
document.title = brand.productName;
for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  const key = element.dataset['i18n'];
  if (isMessageKey(key)) {
    element.textContent = i18n.t(key, { product: brand.productName });
  }
}

const fix = document.getElementById('fix');
const error = document.getElementById('error');
fix?.addEventListener('click', () => {
  fix.setAttribute('disabled', '');
  void bridge
    .invoke('sandboxHelp.installFix', {})
    .then((result) => {
      if (
        typeof result !== 'object' ||
        result === null ||
        !('ok' in result) ||
        result.ok !== true
      ) {
        error?.removeAttribute('hidden');
      }
    })
    .finally(() => fix.removeAttribute('disabled'));
});
document.getElementById('packages')?.addEventListener('click', () => {
  void bridge.invoke('sandboxHelp.openPackages', {});
});
