import Link from "next/link";

import { AdminPage, AdminPanel } from "elestampadero/shared/ui/admin";
import { ProductImportView } from "elestampadero/views/admin-products-import";

export default function AdminProductImportPage() {
  return (
    <AdminPage
      module="Módulo de Productos"
      title="Carga masiva desde Excel"
      description={<Link href="/admin/productos">← Volver a productos</Link>}
      className="admin-products-page"
    >
      <AdminPanel className="admin-panel-pad">
        <ProductImportView />
      </AdminPanel>
    </AdminPage>
  );
}
