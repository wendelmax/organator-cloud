import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "./providers";
import { publicEnvScript, readPublicEnv } from "../lib/public-env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Renderiza por request: a configuração pública vem do ambiente de runtime,
// não do build (ver lib/public-env.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organator Cloud",
  description: "Control Plane para fundadores de SaaS — painel administrativo e onboarding.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: publicEnvScript(readPublicEnv()) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
