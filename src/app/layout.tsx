import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpreadHunter — Spread Capture Bot",
  description: "24×7 cross-exchange bid-ask arbitrage bot dashboard with risk-first execution, strict stop-loss and daily Excel reports.",
  manifest: "/manifest.webmanifest",
  applicationName: "SpreadHunter",
  appleWebApp: { capable: true, title: "SpreadHunter", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e11",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0b0e11] text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
