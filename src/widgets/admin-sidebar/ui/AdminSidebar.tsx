"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAdminNavigation } from "elestampadero/shared/ui/admin/AdminNavigationContext";

type IconName =
  | "dashboard"
  | "products"
  | "orders"
  | "clubs"
  | "designs"
  | "payments"
  | "production"
  | "content"
  | "store"
  | "logout";

const NAV_ITEMS: { label: string; href: string; icon: IconName }[] = [
  { label: "Dashboard", href: "/admin", icon: "dashboard" },
  { label: "Productos", href: "/admin/productos", icon: "products" },
  { label: "Pedidos", href: "/admin/pedidos", icon: "orders" },
  { label: "Socios y convenios", href: "/admin/clubes", icon: "clubs" },
  { label: "Diseños", href: "/admin/disenos", icon: "designs" },
  { label: "Liquidaciones", href: "/admin/liquidaciones", icon: "payments" },
  { label: "Comprobantes", href: "/admin/comprobantes", icon: "payments" },
  { label: "Devoluciones", href: "/admin/devoluciones", icon: "orders" },
  { label: "Producción", href: "/admin/produccion", icon: "production" },
  { label: "Contenidos WEB", href: "/admin/contenidos", icon: "content" },
];

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  products: (
    <>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  clubs: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M15 15c3.2 0 5 1.7 5.5 5" />
    </>
  ),
  designs: (
    <>
      <path d="m4 20 4.2-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z" />
      <path d="m14.8 6.5 3 3M4 20l3-3" />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 15h4" />
    </>
  ),
  production: (
    <>
      <path d="M3 21V9l6 3V8l6 4V5h6v16z" />
      <path d="M7 17h2M13 17h2M18 9h3" />
    </>
  ),
  content: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m4 18 5-5 3 3 3-3 5 5" />
    </>
  ),
  store: (
    <>
      <path d="M3 10h18l-1.5-5h-15z" />
      <path d="M5 10v9h14v-9M9 19v-5h6v5M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
    </>
  ),
};

function AdminNavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="admin-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const {
    pendingHref,
    isNavigating,
    isSidebarCollapsed,
    isMobileMenuOpen,
    navigate,
    toggleSidebar,
    closeMobileMenu,
  } = useAdminNavigation();
  const optimisticPathname = pendingHref?.split("?")[0] ?? pathname;

  function handleNavigation(
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
    label: string,
  ) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    if (!isNavigating) navigate(href, label);
    closeMobileMenu();
  }

  return (
    <aside
      className={`admin-sidebar ${isSidebarCollapsed ? "admin-sidebar--collapsed" : ""} ${isMobileMenuOpen ? "admin-sidebar--mobile-open" : ""}`}
    >
      <Link
        href="/admin"
        className="admin-brand"
        aria-label="Ir al dashboard"
        data-loading-ignore="true"
        aria-disabled={isNavigating}
        onClick={(event) => handleNavigation(event, "/admin", "Dashboard")}
      >
        <span className="admin-brand-mark">
          <Image
            src="/images/icono.jpg"
            alt="El Estampadero"
            fill
            sizes="52px"
            priority
          />
        </span>
        <span className="admin-brand-copy">
          <strong>El Estampadero</strong>
          <small>Panel admin</small>
        </span>
      </Link>

      <button
        type="button"
        className="admin-sidebar-mobile-close"
        onClick={closeMobileMenu}
        aria-label="Cerrar menú"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <button
        type="button"
        className="admin-sidebar-toggle"
        onClick={toggleSidebar}
        aria-label={
          isSidebarCollapsed
            ? "Expandir barra lateral"
            : "Contraer barra lateral"
        }
        aria-expanded={!isSidebarCollapsed}
        title={isSidebarCollapsed ? "Expandir menú" : "Contraer menú"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>

      <nav className="admin-nav" aria-label="Navegación del panel">
        {NAV_ITEMS.map(({ label, href, icon }) => {
          const active =
            href === "/admin"
              ? optimisticPathname === href
              : optimisticPathname.startsWith(href);
          const pending = pendingHref === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              data-loading-ignore="true"
              aria-current={active ? "page" : undefined}
              aria-disabled={isNavigating}
              onClick={(event) => handleNavigation(event, href, label)}
              className={`admin-nav-item ${active ? "active" : ""} ${pending ? "pending" : ""} ${isNavigating ? "locked" : ""}`}
            >
              <AdminNavIcon name={icon} />
              <span className="admin-nav-label">{label}</span>
            </Link>
          );
        })}
        <Link
          href="/"
          title={isSidebarCollapsed ? "Ver web principal" : undefined}
          data-loading-ignore="true"
          aria-disabled={isNavigating}
          onClick={(event) => handleNavigation(event, "/", "Web principal")}
          className={`admin-nav-item ${isNavigating ? "locked" : ""}`}
        >
          <AdminNavIcon name="store" />
          <span className="admin-nav-label">Ver web principal</span>
        </Link>
      </nav>

      <button
        type="button"
        title={isSidebarCollapsed ? "Cerrar sesión" : undefined}
        onClick={() => {
          if (isSigningOut || isNavigating) return;
          setIsSigningOut(true);
          void signOut({ callbackUrl: "/ingresar" });
        }}
        disabled={isSigningOut || isNavigating}
        className="admin-signout"
      >
        <AdminNavIcon name="logout" />
        <span className="admin-nav-label">
          {isSigningOut ? "Saliendo…" : "Cerrar sesión"}
        </span>
      </button>
    </aside>
  );
}
