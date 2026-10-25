"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

const LINKS_MENU_ID = "menu-principal";
const USER_MENU_ID = "menu-usuario";

const BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center gap-2 rounded border border-surface px-3 font-medium text-surface hover:bg-primary-hover";
const ITEM_CLASS =
  "flex min-h-11 w-full items-center rounded px-3 text-surface underline-offset-4 hover:bg-primary-hover hover:underline";
const PANEL_BASE_CLASS =
  "absolute z-20 mt-1 w-max min-w-48 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded border border-surface bg-primary-deep p-1";
const CHEVRON_CLASS = "mb-1 size-2 shrink-0 rotate-45 border-b-2 border-r-2 border-surface";

/** Cierra el menú que contiene al elemento; fuera de un menú no hace nada. */
const MenuCloseContext = createContext<() => void>(ignoreClose);

function ignoreClose(): void {
  // Sin menú plegable alrededor (barra en línea): no hay nada que cerrar.
}

interface Disclosure {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

type RootRef = RefObject<HTMLLIElement | null>;
type ButtonRef = RefObject<HTMLButtonElement | null>;

/**
 * Estado abierto/cerrado de un menú desplegable. Abierto: Escape lo cierra y devuelve el foco a su botón;
 * un clic o el foco fuera de él también lo cierran.
 */
function useDisclosure(rootRef: RootRef, buttonRef: ButtonRef): Disclosure {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onOutside(event: Event) {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open, rootRef, buttonRef]);

  return {
    open,
    toggle: () => setOpen((current) => !current),
    close: () => setOpen(false),
  };
}

/** Clase de visibilidad del panel según esté abierto; `alwaysFromMd` lo deja siempre visible desde 768 px. */
function visibilityClass(open: boolean, alwaysFromMd: boolean): string {
  if (open) {
    return "flex";
  }
  if (alwaysFromMd) {
    return "hidden md:flex";
  }
  return "hidden";
}

/** Enlace de una lista desplegable: al activarlo se cierra el menú que lo contiene. */
export function MenuLink({ href, label, className }: { href: string; label: string; className?: string }) {
  const close = useContext(MenuCloseContext);
  return (
    <Link href={href} onClick={close} className={className ?? ITEM_CLASS}>
      {label}
    </Link>
  );
}

interface ToggleProps {
  menu: Disclosure;
  buttonRef: ButtonRef;
  controls: string;
  className: string;
  children: ReactNode;
}

function ToggleButton({ menu, buttonRef, controls, className, children }: ToggleProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={menu.open}
      aria-controls={controls}
      onClick={menu.toggle}
      className={className}
    >
      {children}
    </button>
  );
}

/**
 * Enlaces de navegación del rol: en línea desde 768 px; por debajo, tras el botón «Menú».
 * Las opciones llegan como `<li>` desde el servidor (`children`).
 */
export function CollapsibleLinks({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLLIElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menu = useDisclosure(rootRef, buttonRef);
  const panelClass = `${PANEL_BASE_CLASS} left-0 md:static md:mt-0 md:w-auto md:min-w-0 md:max-w-none md:flex-row md:flex-wrap md:items-center md:gap-1 md:border-0 md:bg-transparent md:p-0 ${visibilityClass(menu.open, true)}`;
  return (
    <li ref={rootRef} className="relative min-w-0 md:static">
      <ToggleButton menu={menu} buttonRef={buttonRef} controls={LINKS_MENU_ID} className={`${BUTTON_CLASS} md:hidden`}>
        Menú
        <span aria-hidden="true" className={CHEVRON_CLASS} />
      </ToggleButton>
      <MenuCloseContext.Provider value={menu.close}>
        <ul id={LINKS_MENU_ID} className={panelClass}>
          {children}
        </ul>
      </MenuCloseContext.Provider>
    </li>
  );
}

interface UserMenuProps {
  name: string;
  roleLabel: string;
  children: ReactNode;
}

/** Menú de usuario: un botón con el nombre y el rol que despliega sus opciones (`children`, como `<li>`). */
export function UserMenu({ name, roleLabel, children }: UserMenuProps) {
  const rootRef = useRef<HTMLLIElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menu = useDisclosure(rootRef, buttonRef);
  return (
    <li ref={rootRef} className="relative ml-auto min-w-0 max-w-full">
      <ToggleButton
        menu={menu}
        buttonRef={buttonRef}
        controls={USER_MENU_ID}
        className={`${BUTTON_CLASS} max-w-full text-left`}
      >
        <strong className="min-w-0 break-words font-semibold">{name}</strong>
        <small className="shrink-0 text-surface">({roleLabel})</small>
        <span aria-hidden="true" className={CHEVRON_CLASS} />
      </ToggleButton>
      <MenuCloseContext.Provider value={menu.close}>
        <ul id={USER_MENU_ID} className={`${PANEL_BASE_CLASS} right-0 ${visibilityClass(menu.open, false)}`}>
          {children}
        </ul>
      </MenuCloseContext.Provider>
    </li>
  );
}
