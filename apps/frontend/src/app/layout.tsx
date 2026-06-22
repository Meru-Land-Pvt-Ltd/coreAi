import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CoreAI Marketplace",
  description: "AI Agent Marketplace for Businesses and AI Architects",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
