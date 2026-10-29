import type { Metadata } from "next";
import { grotesk, alphaLyrae } from "@ate/design/fonts/fonts";
import "@ate/design/styles/globals.css";

export const metadata: Metadata = {
  title: "ate.ai Digital Workforce",
  description: "Create, configure, train, hire, and manage AI employees.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${grotesk.variable} ${alphaLyrae.variable}`}>
      <body>{children}</body>
    </html>
  );
}
