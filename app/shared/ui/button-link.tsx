import Link from "next/link";
import type { ReactNode } from "react";

/** Enlace con aspecto de botón primario (objetivo táctil de al menos 44 px). */
export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-primary px-4 font-medium text-surface no-underline hover:bg-primary-hover"
    >
      {children}
    </Link>
  );
}
