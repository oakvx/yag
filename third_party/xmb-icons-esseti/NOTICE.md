# PlayStation 3 XMB icons by esseti

Source: the user-supplied `playstation3_xmb_icons_by_esseti_d1bix4r.rar`.
The original `icons_276.svg` is retained here for reproducibility.
The archive contains AI, EPS, PDF, PNG and SVG artwork, but no license file;
this artwork is not covered by YAG's MIT license or the separate RetroArch
icon pack's license.

`scripts/extract-ps3-icons.mjs` selects 19 matching vector groups, removes
non-geometry attributes, changes their solid paint to white for the existing
luminance masks, and centers each icon in a 64 x 64 viewBox with 3px padding.
The generated files live in `public/icons/xmb/`; `ConsoleIcon` discovers them
through its existing optional-asset mechanism. Unmapped icons retain the
existing built-in artwork.

Regenerate after installing the project's development dependencies and a
Playwright browser:

```sh
node scripts/extract-ps3-icons.mjs
```

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge browser.
