import { AdminPage, AdminPanel } from "elestampadero/shared/ui/admin";
import { AdminInvoicesView } from "elestampadero/views/admin-invoices";

export default function AdminInvoicesPage() {
  return (
    <AdminPage
      module="Facturación"
      title="Comprobantes"
      description="Facturas y notas de crédito emitidas en ARCA a través de Facturante."
    >
      <AdminPanel className="admin-panel-pad">
        <AdminInvoicesView />
      </AdminPanel>
    </AdminPage>
  );
}
