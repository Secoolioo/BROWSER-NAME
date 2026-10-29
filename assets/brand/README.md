# Brand assets

| File            | Content                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| `app-icon.svg`  | Application icon: the mark in white on a flat plate in the light accent color #1570d1. |
| `logo-mark.svg` | The mark alone in one color (`currentColor`), for 16 px use, print and dark surfaces.  |
| `wordmark.svg`  | The name in lowercase, as outlines in one color (`currentColor`).                      |

The mark is a browser window with a full-height side panel and a toolbar: the layouts Astela is built around, with tab bars on any side. It is drawn with one stroke width and small inner radii, without gradients, shadows or effects (see [design rules](../../docs/architecture/design-system.md#design-rules)). The rounded plate of the application icon follows the icon grid of the operating systems.

The wordmark is set in Inter Display SemiBold (SIL Open Font License 1.1) and converted to outlines, so it needs no font.

`app/build/icon.png` is rendered from `app-icon.svg` at 1024 × 1024 px by `node tools/brand/render-icon.ts`. electron-builder derives the Windows, macOS and Linux icons from that file. Render it again after every change to the SVG and commit both files.
