import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Pool } from "pg";

// Inizializza il pool di connessione a Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // Mantieni una singola connessione per transazioni di backup/ripristino
  idleTimeoutMillis: 10000,
});

// Protezione dell'endpoint: solo utenti con accesso in scrittura a "gestione" (ADMIN)
async function requireGestioneWrite() {
  const supabaseServer = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Non autenticato." };

  const { data, error } = await supabaseServer.rpc("has_module_access", {
    target_module: "gestione",
    require_write: true,
  });
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 403, error: "Permessi insufficienti." };
  return { ok: true as const, email: user.email };
}

// Elenco ordinato di tutte le tabelle per l'esportazione e l'importazione
const BACKUP_TABLES = [
  "profiles",
  "module_permissions",
  "sites",
  "sub_sites",
  "employees",
  "training_courses",
  "training_matrix_rules",
  "training_rule_links",
  "training_employee_courses",
  "employee_freeze_periods",
  "training_scope_exclusions",
  "training_employee_exclusions",
  "training_employee_course_exclusions",
  "medical_surveillance_records",
  "medical_surveillance_job_rules",
  "medical_surveillance_scope_rules",
  "medical_surveillance_provider_assignments",
  "medical_surveillance_employee_exclusions",
  "medical_surveillance_employee_overrides",
  "import_runs",
  "import_run_errors",
  "fleet_assets",
  "fleet_obligation_types",
  "fleet_asset_obligations",
  "fleet_obligation_events",
  "fleet_asset_assignments",
  "dpi_items",
  "dpi_matrix_rules",
  "dpi_employee_items",
  "turni_site_templates",
  "turni_site_template_slots",
  "turni_employee_site_assignments",
  "turni_employee_shifts",
  "turni_shift_breaks",
  "turni_employee_absences",
  "turni_month_locks",
  "turni_site_month_targets",
  "anagrafica_import_tax_codes",
  "employee_status_audit",
  "import_run_changes",
  "import_run_undos",
  "turni_employee_templates",
  "turni_employee_template_slots",
  "import_undo_deleted_rows"
];

// Ordine di caricamento (relazioni/dependency order) per evitare violazioni di chiavi esterne
const INSERT_ORDER = [
  "profiles",
  "module_permissions",
  "sites",
  "sub_sites",
  "employees",
  "training_courses",
  "training_matrix_rules",
  "training_rule_links",
  "training_employee_courses",
  "employee_freeze_periods",
  "training_scope_exclusions",
  "training_employee_exclusions",
  "training_employee_course_exclusions",
  "medical_surveillance_records",
  "medical_surveillance_job_rules",
  "medical_surveillance_scope_rules",
  "medical_surveillance_provider_assignments",
  "medical_surveillance_employee_exclusions",
  "medical_surveillance_employee_overrides",
  "import_runs",
  "import_run_errors",
  "fleet_assets",
  "fleet_obligation_types",
  "fleet_asset_obligations",
  "fleet_obligation_events",
  "fleet_asset_assignments",
  "dpi_items",
  "dpi_matrix_rules",
  "dpi_employee_items",
  "turni_site_templates",
  "turni_site_template_slots",
  "turni_employee_site_assignments",
  "turni_employee_shifts",
  "turni_shift_breaks",
  "turni_employee_absences",
  "turni_month_locks",
  "turni_site_month_targets",
  "anagrafica_import_tax_codes",
  "employee_status_audit",
  "import_run_changes",
  "import_run_undos",
  "turni_employee_templates",
  "turni_employee_template_slots",
  "import_undo_deleted_rows"
];

export const runtime = "nodejs";

// GET /api/gestione/backup -> Scarica il dump JSON di tutte le tabelle
export async function GET(request: Request) {
  const auth = await requireGestioneWrite();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const backupData: Record<string, any[]> = {};

    for (const table of BACKUP_TABLES) {
      const { data, error } = await supabaseAdmin.from(table).select("*");
      if (error) {
        throw new Error(`Errore estrazione tabella ${table}: ${error.message}`);
      }
      backupData[table] = data ?? [];
    }

    const payload = {
      version: "1.0",
      createdAt: new Date().toISOString(),
      createdBy: auth.email,
      tables: backupData,
    };

    const jsonString = JSON.stringify(payload, null, 2);
    const dateStr = new Date().toISOString().split("T")[0];
    const timeStr = new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
    const filename = `backup_kontrol_${dateStr}_${timeStr}.json`;

    return new Response(jsonString, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore durante il backup." },
      { status: 500 }
    );
  }
}

// POST /api/gestione/backup -> Ripristina il database partendo dal file JSON caricato
export async function POST(request: Request) {
  const auth = await requireGestioneWrite();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let dbClient: any = null;
  try {
    const body = await request.json();
    if (!body || body.version !== "1.0" || !body.tables) {
      return NextResponse.json({ error: "File di backup non valido o non compatibile." }, { status: 400 });
    }

    const tables = body.tables;

    // Connessione diretta a Postgres tramite pg per supportare transazioni atomiche
    dbClient = await pool.connect();
    await dbClient.query("BEGIN");

    // 1. Truncate in cascata di tutte le tabelle tranne 'profiles' per non cancellare gli account attivi
    // Troncando con CASCADE, Postgres elimina automaticamente tutti i dati rispettando i vincoli
    const truncateTables = INSERT_ORDER.filter(t => t !== "profiles").map(t => `public."${t}"`).join(", ");
    await dbClient.query(`TRUNCATE TABLE ${truncateTables} CASCADE`);

    // 2. Ripopolamento tabelle in ordine di dipendenza chiavi esterne (INSERT_ORDER)
    for (const tableName of INSERT_ORDER) {
      const rows = tables[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Estrai le colonne ed i valori di ciascuna riga
      const columns = Object.keys(rows[0]);
      const columnsStr = columns.map(c => `"${c}"`).join(", ");

      for (const row of rows) {
        const values = columns.map(c => row[c]);
        const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(", ");
        
        let query = "";
        if (tableName === "profiles") {
          // Per profiles facciamo un upsert, così aggiorniamo i profili senza cancellare gli utenti registrati
          const updateStr = columns.filter(c => c !== "id").map(c => `"${c}" = EXCLUDED."${c}"`).join(", ");
          query = `
            INSERT INTO public."profiles" (${columnsStr}) 
            VALUES (${placeholders})
            ON CONFLICT (id) DO UPDATE SET ${updateStr}
          `;
        } else {
          query = `INSERT INTO public."${tableName}" (${columnsStr}) VALUES (${placeholders})`;
        }

        await dbClient.query(query, values);
      }

      // 3. Ripristino del cursore della sequenza (autoincrement/serial) in base all'ID massimo caricato
      const hasIdColumn = columns.includes("id");
      if (hasIdColumn && tableName !== "profiles") {
        try {
          await dbClient.query(`
            SELECT setval(
              pg_get_serial_sequence('public."${tableName}"', 'id'), 
              coalesce((SELECT max(id) FROM public."${tableName}"), 1)
            )
          `);
        } catch (seqErr) {
          // Ignorato in caso di chiavi UUID o tabelle senza sequenza serial
        }
      }
    }

    // Conferma della transazione
    await dbClient.query("COMMIT");
    return NextResponse.json({ ok: true, message: "Database ripristinato con successo." });

  } catch (err) {
    if (dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Errore durante rollback:", rollbackErr);
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore durante il ripristino." },
      { status: 500 }
    );
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
}
