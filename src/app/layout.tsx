import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voho Track",
  description: "Voho Track dashboard",
  icons: {
    icon: "/favicon-idle-v2.svg",
    shortcut: "/favicon-idle-v2.svg",
    apple: "/favicon-idle-v2.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
