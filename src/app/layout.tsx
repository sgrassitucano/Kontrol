import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Montserrat, Roboto } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-atkinson",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});

const roboto = Roboto({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "Gestionale Morelli",
  description:
    "Scheletro applicativo per il gestionale interno Cooperativa Morelli.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body
        className={`${atkinson.variable} ${montserrat.variable} ${roboto.variable} min-h-full font-sans text-foreground`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
