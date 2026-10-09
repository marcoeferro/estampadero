import Link from "next/link";

import { AdminPage, AdminPanel } from "elestampadero/shared/ui/admin";
import { api } from "elestampadero/trpc/server";
import { AdminProductsManager } from "elestampadero/views/admin-products";

interface AdminProductsPageProps {
  searchParams: Promise<{ crear?: string; clubId?: string }>;
}

export default async function AdminProductsPage({
  searchParams,
}: AdminProductsPageProps) {
  const requested = await searchParams;
  const [products, clubs, lines] = await Promise.all([
    api.catalog.adminList(),
    api.clubs.list(),
    api.catalog.lines(),
  ]);

  return (
    <AdminPage
      module="Módulo de Productos"
      title="Gestión de productos"
      description={
        <Link href="/admin/productos/carga-masiva">
          Carga masiva desde Excel →
        </Link>
      }
      className="admin-products-page"
    >
      <AdminPanel className="admin-panel-pad admin-products-panel">
        <AdminProductsManager
          initialProducts={products}
          clubs={clubs}
          initialLines={lines}
          initialClubId={requested.clubId}
          initialCreateMode={requested.crear === "1"}
        />
      </AdminPanel>
    </AdminPage>
  );
}
