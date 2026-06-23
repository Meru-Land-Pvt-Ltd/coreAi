import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: "CoreAI Agent Marketplace",
  description: "AI Agent Marketplace for Businesses and AI Architects"
};

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