import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CP Panel - Painel de Partidas",
  description: "Painel de partidas de comboios da CP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
