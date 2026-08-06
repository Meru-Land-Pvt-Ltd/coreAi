import type { Metadata } from "next";
import "./global.css";
import { buildRootMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = buildRootMetadata();

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
