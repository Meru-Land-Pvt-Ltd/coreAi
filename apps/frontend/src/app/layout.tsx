import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: "Triven.Ai Agent Marketplace",
  description: "AI Agent Marketplace for Businesses and AI Architects"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-testid="app-layout-html-1" lang="en">
      <body data-testid="app-layout-body-1">{children}</body>
    </html>
  );
}