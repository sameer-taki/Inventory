import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Golden Operations Platform",
  description:
    "Golden Manufacturers Group — operations platform (MAX replacement, quality, fleet).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
