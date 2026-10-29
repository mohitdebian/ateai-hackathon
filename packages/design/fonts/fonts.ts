import localFont from "next/font/local";

// Alpha Lyrae = logotype wordmark ONLY. Overused Grotesk = everything else.
export const grotesk = localFont({
  src: "./OverusedGrotesk-VF.woff2",
  variable: "--font-grotesk",
  weight: "300 900",
  display: "swap",
});

export const alphaLyrae = localFont({
  src: "./AlphaLyrae-Medium.woff2",
  variable: "--font-alpha-lyrae",
  weight: "400 600",
  display: "swap",
});
