import type { CSSProperties } from "react";

/**
 * Paired tile/ink colours, muted enough to read as a document rather than a
 * sticker sheet. Two rules hold the set together: every tile is lighter than
 * the card it sits on, and each ink is chosen for its own tile — one shared
 * ink cannot hold its contrast across eight hues. Every pair clears WCAG AA.
 */
const AVATAR_TINTS = [
  { bg: "#453d55", fg: "#d8cfe8" }, // violet
  { bg: "#2f4a58", fg: "#c4dde8" }, // blue
  { bg: "#4a4038", fg: "#e2d3c4" }, // amber
  { bg: "#314a47", fg: "#c2e0da" }, // teal
  { bg: "#543a42", fg: "#ebcbd3" }, // rose
  { bg: "#383e57", fg: "#cbd1eb" }, // indigo
  { bg: "#3a4739", fg: "#cfe0cb" }, // sage
  { bg: "#33454f", fg: "#c8dee8" }, // slate
] as const;

/** Two-letter initials, matching the avatar tiles in the product Figma. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable local tint for each person without exposing their identifier. */
export function avatarTint(name: string): CSSProperties {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  const tint = AVATAR_TINTS[(hash >>> 0) % AVATAR_TINTS.length];
  return {
    "--avatar-bg": tint.bg,
    "--avatar-fg": tint.fg,
  } as CSSProperties;
}

/**
 * Initials tile. Drawn locally rather than fetched from an avatar service: no
 * request per person on screen, nothing to render when that service is slow or
 * down, no layout shift, and no name or email address leaving the app.
 *
 * A div, not a span: every container that holds an avatar (.org-card,
 * .account-person, .member-person) also styles `span` as its subtitle text,
 * and those selectors outrank the tile's own class.
 *
 * Decorative — every caller renders the name next to the tile.
 */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const classList = new Set<string>();
  classList.add("person-avatar");
  if (className) {
    for (const c of className.split(/\s+/)) {
      if (c) classList.add(c);
    }
  }
  classList.add("avatar-tint");

  return (
    <div
      className={Array.from(classList).join(" ")}
      style={avatarTint(name)}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
