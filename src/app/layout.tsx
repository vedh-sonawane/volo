import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Volo — tell us what you want done",
  description:
    "Volo is an objective-to-outcome execution engine. Give it a goal; it plans, researches the web, extracts and compares real options, and reports an outcome with sources — honestly.",
};

export const viewport: Viewport = {
  themeColor: "#fbfaf7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
