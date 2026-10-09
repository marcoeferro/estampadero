import { NextResponse } from "next/server";

import { buildImportTemplate } from "elestampadero/server/modules/catalog/infrastructure/bulk-import/workbook";
import { auth } from "elestampadero/server/auth";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!ADMIN_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
  }

  const file = await buildImportTemplate();
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="planilla-carga-productos.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
