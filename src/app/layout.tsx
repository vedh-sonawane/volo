import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Volo — tell us what you want done",
  description:
    "Volo is an objective-to-outcome execution engine. Give it a goal; it plans, researches the web, extracts and compares real options, and reports an outcome with sources — honestly.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Set the theme BEFORE first paint (no flash). Respects a saved choice, else the
// OS preference. Kept tiny and inline so it runs synchronously in <head>.
const themeScript = `
(function(){try{
  var t = localStorage.getItem('volo-theme');
  if(t!=='light'&&t!=='dark'){t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';}
  document.documentElement.dataset.theme = t;
}catch(e){document.documentElement.dataset.theme='light';}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
