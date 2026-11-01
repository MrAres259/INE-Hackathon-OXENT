import type { Metadata, Viewport } from "next";
import { Montserrat, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { AtalayaProvider } from "@/lib/state";
import { TopBar } from "@/components/layout/TopBar";
import { Toaster } from "@/components/ui/Toaster";
import { GuideHost } from "@/components/guide/GuideHost";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-display-src",
  display: "swap",
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-src",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: {
    default: "Atalaya Electoral — Riesgo de abstención 2027",
    template: "%s · Atalaya Electoral",
  },
  description:
    "Tablero analítico predictivo para personal del INE: semáforo de riesgo, simulación de escenarios preventivos y asistente conversacional.",
  applicationName: "Atalaya Electoral",
  openGraph: {
    title: "Atalaya Electoral — Riesgo de abstención 2027",
    description:
      "Tablero analítico predictivo para personal del INE: semáforo de riesgo, simulación de escenarios preventivos y asistente conversacional.",
    type: "website",
    locale: "es_MX",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${montserrat.variable} ${sourceSans3.variable} h-full antialiased`}
    >
      <body className="min-h-dvh flex flex-col font-sans bg-background text-foreground antialiased">
        <AtalayaProvider>
          <TopBar />
          <main className="flex-1 min-h-0 flex flex-col">
            {children}
          </main>
          <Toaster />
          <GuideHost />
        </AtalayaProvider>
      </body>
    </html>
  );
}
