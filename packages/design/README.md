# @ate/design

Brand assets and the base stylesheet the product app builds on.

Brand assets and the base stylesheet for ate.ai.

## Contents

| Path | What it is |
|---|---|
| `styles/globals.css` | Design tokens, reset, and the base type/button/card classes |
| `fonts/fonts.ts` | Overused Grotesk (UI) and Alpha Lyrae (logotype), via `next/font/local` |
| `components/brand/` | The ate.ai brand mark — `AteMark.tsx` |
| `components/` | `Button`, `Card`, `Typography` |

## Colour

`--ate-blue` (`#006DEC`) and `--sky-blue` (`#40B9FF`) are fixed brand colours.

There is one palette, declared once, in `:root`. An app-level stylesheet may
*use* a token but must never redefine one; a `.some-scope { --blue: … }` block
forks the brand and is exactly what this package exists to prevent.

## Usage

Import by subpath — there is no barrel:

```tsx
import { Button } from "@ate/design/components/Button";
import "@ate/design/styles/globals.css";
```

`apps/web/next.config.mjs` lists this package in `transpilePackages`, since it
ships raw TSX from the workspace rather than a build output.
