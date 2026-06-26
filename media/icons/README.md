# loom icon set — ctxloom · taskloom · ltk

Dev-ready marks for the three tools. One visual system: a woven loom corner-frame
that nests the tool's initial. Each tool owns one colour; the shared "loom" green is
constant. At favicon sizes the nested letter is dropped and the loom's rightmost
warp thread is dyed the tool colour instead.

## Colours
| token        | hex       | use                                  |
|--------------|-----------|--------------------------------------|
| ctx green    | `#2bb061` | ctxloom letter + warp; loom frame    |
| task blue    | `#3f93d6` | taskloom letter + warp               |
| ltk amber    | `#e6a83f` | ltk letter + warp                    |
| loom green   | `#2f7d5b` | favicon loom base threads            |
| tile bg      | `#090d0b` | icon background (near-black)         |

## What's in each tool folder (`ctxloom/`, `taskloom/`, `ltk/`)
| file                     | what it is                                              | hand to                          |
|--------------------------|---------------------------------------------------------|----------------------------------|
| `<tool>.svg`             | colour glyph, **transparent** bg, font embedded         | master vector / source of truth  |
| `<tool>-tile.svg`        | colour glyph on dark rounded tile (512), font embedded  | app / store icon, scalable       |
| `<tool>-mono.svg`        | single-colour glyph using `currentColor`, transparent   | VS Code activity-bar / theme icon|
| `<tool>-favicon.svg`     | simplified loom + coloured warp on tile (64)            | small favicon, scalable          |
| `png/<tool>-16/32/48`    | favicon artwork, rasterised                              | browser favicon                  |
| `png/<tool>-64/128/256/512` | app artwork (nested letter), rasterised              | **128 = VS Code Marketplace icon** |

## Quick wiring

**Web favicon**
```html
<link rel="icon" type="image/svg+xml" href="ctxloom/ctxloom-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="ctxloom/png/ctxloom-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="ctxloom/png/ctxloom-16.png">
```

**VS Code extension** (`package.json`)
```json
{ "icon": "icons/ctxloom/png/ctxloom-128.png" }
```

**VS Code activity-bar / product icon** — use the `-mono.svg`; it inherits the
theme's foreground via `currentColor`, so it adapts to light/dark automatically.

## Notes
- SVGs are **self-contained**: JetBrains Mono ExtraBold (the nested letter) is
  embedded as a base64 `@font-face`, so they render identically in browsers, Figma
  and when rasterised — no font install needed.
- If you'd rather not embed the font, swap the `@font-face` in the `*.svg`/`*-tile.svg`
  for a local reference to `fonts/JetBrainsMono-ExtraBold.woff2` (included), or
  convert the letter to outlines.
- Font: **JetBrains Mono**, SIL Open Font License 1.1 — see `fonts/OFL.txt`. Free to
  embed and ship (commercial included); keep the licence file alongside it.
- `preview.html` — open in a browser to see every asset on the dark UI.
