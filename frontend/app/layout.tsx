import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Midday Surplus → Tokens",
  description: "How much AI inference fits in the grid's midday net-load dip — on real ISO data.",
};

// System font stack only: no build-time font downloads (reliable offline/CI builds).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
