import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Biblioteca de préstamos",
  description: "Proyecto del curso de Tendencias: desarrollo con agentes de IA",
};

const NAV_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded px-3 text-surface hover:bg-primary-hover hover:text-surface";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col bg-surface text-ink">
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <header className="bg-primary-strong text-surface">
          <nav aria-label="Principal" className="mx-auto w-full max-w-5xl px-4">
            <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 py-2">
              <li>
                <Link href="/" className={`${NAV_LINK_CLASS} font-semibold`}>
                  Biblioteca
                </Link>
              </li>
              <li>
                <Link href="/cuentas" className={NAV_LINK_CLASS}>
                  Cuentas
                </Link>
              </li>
              <li className="ml-auto">
                <Link href="/login" className={NAV_LINK_CLASS}>
                  Ingresar
                </Link>
              </li>
            </ul>
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
