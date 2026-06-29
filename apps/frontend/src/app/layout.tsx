import type { Metadata } from "next";
import "./global.css";

export const metadata: Metadata = {
  title: "Your AI Workforce",
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