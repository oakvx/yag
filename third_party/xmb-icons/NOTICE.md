# XMB console artwork

The XMB category and item glyphs in `src/xmb/xmbIcons.ts` come from the
"PS3 Icons + Sounds" community pack for RetroArch's XMB interface:

    https://github.com/JMRDev0/XMB-PS3-Icons-Sounds-Pack-

That pack redistributes the XMB icon set of RetroArch's `systematic` XMB theme
under the MIT License reproduced in `LICENSE` (Copyright (c) 2025 Justin Rankin).
The pack itself contains no source code — only the icon artwork — and the
PlayStation 3 system sounds and the PS4 logo typeface that ship with it are not
used here.

## What was changed

The upstream artwork is 128 px PNG. For this repository it was converted to
vector outlines:

1. The alpha channel of each PNG was sampled on a corner lattice and the
   outline was traced with marching squares, interpolating every edge crossing
   from the original alpha values.
2. The resulting contours were simplified and normalised into a 64 x 64 box
   (content fitted and centred), then emitted as a single SVG path per icon
   (`fill-rule="evenodd"`, so counters are real holes).
3. The small "options" badge that the source set places on top of some system
   glyphs was removed where it carried no meaning in this interface.

No shape was redrawn by hand: every icon in `src/xmb/xmbIcons.ts` is a trace of
the upstream artwork, re-fitted to the console grid.

## Runtime behaviour

`src/xmb/ConsoleIcons.tsx` fills those paths with the console's silver
gradient. If you own a different set of XMB artwork, drop SVGs named after the
icons into `public/icons/xmb/` (`home.svg`, `gateway.svg`, …) and they replace
the built-in outlines at runtime.
