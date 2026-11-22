# FONTLOG: Clarity Cut (working name)

## Basic information
Clarity Cut is a derivative of Orbitron 2.001 (variable, wght 400 to 900) by Matt McInerney / The League of Moveable Type,
licensed under the SIL Open Font License 1.1 (see OFL.txt). "Orbitron" is a Reserved Font Name, so this derivative
does not use it in any family, full or PostScript name. Clarity Cut declares no Reserved Font Name of its own.

Its outlines follow the corner logic of the Clarity wordmark (Clarity Control brand):
- every large outer rounding becomes one 45° cut whose legs are 0.643 × the stem of that weight
  (measured on the wordmark: 65.65 / 102.17)
- every inner fillet and inner-counter corner becomes square
- small outer roundings (tangent leg under 60 units at wght 800) become square

Extensions for the full character set: semicircular ends split into two corners; acute outer tips are cut no
shallower than the original rounding reached; a cut never runs deeper than the original rounding; round dots and
rings (bullet, degree, percent) become octagons. The narrowed logo C is not part of the font; C is Orbitron's width.

## Files
| File | What |
| --- | --- |
| `ClarityCut[wght].ttf` / `.woff2` | Variable font, wght 400 to 900 (default 400) |
| `ClarityCut-{Regular,Medium,SemiBold,Bold,ExtraBold,Black}.ttf` / `.woff2` | Static instances 400/500/600/700/800/900, overlaps removed |
| `OFL.txt` | Licence with both copyright lines |

CSS: `@font-face { font-family: "Clarity Cut"; src: url("ClarityCut[wght].woff2") format("woff2"); font-weight: 400 900; }`
and `font-variant-ligatures: none` (the font has no ligatures anyway).

## Technical notes
- Two masters (400 and 900), exactly as in Orbitron, so interpolation is linear between them. Orbitron's avar weight
  mapping is kept, so wght 800 has Orbitron 800's stems (the wordmark weight). Removing the avar would give a strictly
  linear wght scale at the cost of 500 to 800 being lighter than Orbitron's.
- Corner topology is decided once at wght 800 and applied to both masters; cut legs use each master's stem
  (cap stem 81 at 400, 155 at 900; lowercase 82 / 154).
- Metrics, cmap, glyph set (266), HVAR, GPOS kern + mark, GDEF and STAT are Orbitron's, unchanged.
  GSUB keeps only opt-in features (aalt, salt, smcp, ss01 to ss03); there is no liga or calt.
- Glyphs where contours overlap (Q, R, Q.alt, q.sc) carry the OVERLAP_SIMPLE flag in the variable font; the static
  instances have overlaps removed.
- Build: `src/build.py` (fontTools, skia-pathops, brotli). QA: `src/qa.py` writes `qa-report.json`.

## ChangeLog
- 2026-11-03 1.000: first build from Orbitron-VariableFont_wght.ttf 2.001.

## Acknowledgements
- Matt McInerney, The League of Moveable Type: Orbitron (design, 2009 to 2018).
- Clarity Control: corner-cut modifications (2026).
