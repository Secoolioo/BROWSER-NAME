import type { ContextMenuLabels } from '../domain/context-menu/context-menu.ts';
import { translatorFor } from './i18n/i18n.ts';

/**
 * The texts of the context menus in the language of the application, as each system writes
 * its menus: with access keys on Windows and Linux, and English in title case on macOS.
 * @param locale - The application locale, `app.getLocale()`.
 * @param platform - `process.platform`.
 */
export function contextMenuLabels(locale: string, platform: string): ContextMenuLabels {
  const i18n = translatorFor(locale, platform);
  return {
    openLinkInNewTab: i18n.t('contextMenu.openLinkInNewTab'),
    copyLinkAddress: i18n.t('contextMenu.copyLinkAddress'),
    openImageInNewTab: i18n.t('contextMenu.openImageInNewTab'),
    copyImage: i18n.t('contextMenu.copyImage'),
    copyImageAddress: i18n.t('contextMenu.copyImageAddress'),
    undo: i18n.t('contextMenu.undo'),
    redo: i18n.t('contextMenu.redo'),
    cut: i18n.t('contextMenu.cut'),
    copy: i18n.t('contextMenu.copy'),
    paste: i18n.t('contextMenu.paste'),
    selectAll: i18n.t('contextMenu.selectAll'),
    back: i18n.t('contextMenu.back'),
    forward: i18n.t('contextMenu.forward'),
    reload: i18n.t('contextMenu.reload'),
    searchFor: (engine, query) => i18n.t('contextMenu.searchFor', { engine, query }),
  };
}
