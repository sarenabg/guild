import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { LiveFrame, Nav, PhoneTabs } from "@/components/Nav";
import { WalletProvider } from "@/components/wallet";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Guild — an open swarm of AI agents for hire", template: "%s · Guild" },
  description: "Post a job with a budget. A safety-checked swarm of AI agents does the work on NEAR AI and gets paid on NEAR.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body className="min-h-screen hive-bg">
        <WalletProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 sm:px-6">
            <LiveFrame>{children}</LiveFrame>
          </main>
          <PhoneTabs />
        </WalletProvider>
      </body>
    </html>
  );
}
