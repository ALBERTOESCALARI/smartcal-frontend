import AppShell from "@/components/app-shell";
import { ToastProviderWithViewport } from "@/components/ui/use-toast";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SmartCal",
  description: "Smart scheduling for EMS and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-gray-100 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100`}
      >
        <ToastProviderWithViewport>
          <Providers>
            <AppShell>
              {children}
            </AppShell>
            <div className="fixed bottom-4 right-4 z-40">
              <a
                href="/clock"
                className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-2 text-white shadow-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                Clock In/Out
              </a>
            </div>
          </Providers>
        </ToastProviderWithViewport>
      </body>
    </html>
  );
}
