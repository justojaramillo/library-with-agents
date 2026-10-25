import type { Metadata } from "next";
import { Suspense } from "react";
import { NavBarFallback } from "@/features/accounts/ui/nav-bar";
import { ClientSetup } from "@/shared/ui/client-setup";
import { SessionNav } from "./session-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Biblioteca de préstamos",
  description: "Proyecto del curso de Tendencias: desarrollo con agentes de IA",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col bg-surface text-ink">
        <ClientSetup />
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <header className="bg-primary-strong text-surface">
          <nav aria-label="Principal" className="mx-auto w-full max-w-5xl px-4">
            <Suspense fallback={<NavBarFallback />}>
              <SessionNav />
            </Suspense>
          </nav>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="bg-primary-deep text-surface">
          <p className="mx-auto w-full max-w-5xl px-4 py-4">
            Biblioteca de préstamos · Proyecto del curso de Tendencias
          </p>
        </footer>
      </body>
    </html>
  );
}
