# Keyboard shortcuts

> **Status:** available from 0.1.0-beta.2.

Astela uses the shortcuts that are usual on each operating system. They work the same way in the address bar and in web pages. Shortcuts cannot be changed yet; a shortcut editor is planned for 0.1.0, see the [roadmap](../roadmap.md).

## Windows and Linux

| Action                     | Shortcut                                        |
| -------------------------- | ----------------------------------------------- |
| New tab                    | `Ctrl+T`                                        |
| Close the tab              | `Ctrl+W` or `Ctrl+F4`                           |
| Reopen the last closed tab | `Ctrl+Shift+T`                                  |
| Next tab                   | `Ctrl+Tab` or `Ctrl+Page Down`                  |
| Previous tab               | `Ctrl+Shift+Tab` or `Ctrl+Page Up`              |
| Back                       | `Alt+Left Arrow` or the keyboard's Back key     |
| Forward                    | `Alt+Right Arrow` or the keyboard's Forward key |
| Reload                     | `F5` or `Ctrl+R`                                |
| Go to the address bar      | `Ctrl+L`, `Alt+D` or `F6`                       |

`Ctrl+Shift+R`, `Shift+F5` and `Ctrl+F5` reload the page as well. A reload that bypasses the cache is not available yet.

None of these shortcuts combines Ctrl and Alt. Windows reports the AltGr key as Ctrl+Alt, so AltGr keeps typing characters such as `@`, `€` or `{`.

## macOS

| Action                     | Shortcut                                                              |
| -------------------------- | --------------------------------------------------------------------- |
| New tab                    | `Command+T`                                                           |
| Close the tab              | `Command+W`                                                           |
| Reopen the last closed tab | `Command+Shift+T`                                                     |
| Next tab                   | `Control+Tab`, `Command+Option+Right Arrow` or `Command+Shift+]`      |
| Previous tab               | `Control+Shift+Tab`, `Command+Option+Left Arrow` or `Command+Shift+[` |
| Back                       | `Command+[`                                                           |
| Forward                    | `Command+]`                                                           |
| Reload                     | `Command+R`                                                           |
| Go to the address bar      | `Command+L`                                                           |

`Command+Shift+R` reloads the page as well.

`Command+Left Arrow` and `Command+Right Arrow` move the cursor to the start and the end of the line, as everywhere on macOS, so they do not go back and forward. `Command+Tab` switches between apps.

On keyboard layouts that need Option, or Option and Shift, to type `[` and `]`, such as German or French, press Command together with the keys that type the bracket.

## Mouse

The back and forward buttons of a mouse go back and forward in the current tab, over the page as well as over the toolbar.

## Other layouts and input methods

Letter shortcuts also work with keyboard layouts for other scripts, such as Cyrillic, Greek, Arabic or Devanagari. They use the key that carries the letter on an English keyboard. The shortcuts with `[` and `]` on macOS do the same on layouts that type letters of another script on these keys, such as Russian or Arabic.

While an input method composes text, for example in Japanese or Chinese, its keys belong to the input method and do not run shortcuts.

## Shortcuts in web pages

The browser handles these shortcuts before the page sees the key, so a web page cannot use them for its own functions. All other keys go to the page.
