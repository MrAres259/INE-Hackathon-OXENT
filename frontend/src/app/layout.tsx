import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AtalayaProvider } from "@/lib/state";
import { TopBar } from "@/components/layout/TopBar";
import { ScenarioControls } from "@/components/layout/ScenarioControls";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "ATALAYA — Riesgo de Abstención Electoral 2027",
  description:
    "Tablero analítico predictivo para personal del INE: semáforo de riesgo, simulación de escenarios preventivos y asistente conversacional.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-dvh lg:h-dvh flex flex-col font-sans bg-slate-950 text-slate-100">
        <AtalayaProvider>
          <TopBar />
          <ScenarioControls />
          <main className="flex-1 min-h-0 w-full max-w-[1700px] mx-auto p-3 md:p-5 flex flex-col">
            {children}
          </main>
        </AtalayaProvider>
      </body>
    </html>
  );
}
