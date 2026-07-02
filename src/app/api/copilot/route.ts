import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { copilotLimiter } from "@/lib/api/rate-limit";

// Protezione: qualsiasi utente loggato con accesso operativo può usare il Copilot
async function requireAuth() {
  const supabaseServer = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Non autenticato." };
  return { ok: true as const, email: user.email, userId: user.id };
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateCheck = copilotLimiter.check(auth.userId);
  if (!rateCheck.success) {
    return NextResponse.json(
      { error: "Troppe richieste al copilot. Riprova tra poco." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rateCheck.reset - Date.now()) / 1000)) },
      },
    );
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return NextResponse.json(
      { error: "Assistente AI non configurato (GEMINI_API_KEY mancante nel server)." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { messages } = body as { messages: Array<{ role: "user" | "model"; content: string }> };
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messaggi non validi." }, { status: 400 });
    }

    // 1. Estrazione del contesto in tempo reale dal Database
    const supabaseAdmin = createSupabaseAdminClient();

    // A. Caricamento anagrafiche siti e cantieri
    const [sitesRes, subSitesRes] = await Promise.all([
      supabaseAdmin.from("sites").select("id, name"),
      supabaseAdmin.from("sub_sites").select("id, name, site_id"),
    ]);

    const siteMap = new Map((sitesRes.data ?? []).map(s => [s.id, s.name]));
    const subSiteMap = new Map((subSitesRes.data ?? []).map(s => [s.id, s.name]));

    // B. Caricamento lavoratori attivi
    const { data: employees } = await supabaseAdmin
      .from("employees")
      .select("id, cognome, nome, matricola, mansione, site_id, sub_site_id")
      .eq("is_active", true);

    const activeEmployees = (employees ?? []).map(e => ({
      id: e.id,
      nominativo: `${e.cognome} ${e.nome}`,
      matricola: e.matricola,
      mansione: e.mansione ?? "Non specificata",
      cantiere: siteMap.get(e.site_id) ?? "Sede Centrale",
      sottocantiere: subSiteMap.get(e.sub_site_id) ?? "Nessuno",
    }));

    // C. Caricamento criticità Formazione (corsi scaduti, in scadenza o da fare)
    const { data: training } = await supabaseAdmin
      .from("training_employee_courses")
      .select("employee_id, course_id, date_scadenza, stato")
      .in("stato", ["scaduto", "in scadenza", "da fare"]);

    const { data: courses } = await supabaseAdmin.from("training_courses").select("id, title, code");
    const courseMap = new Map((courses ?? []).map(c => [c.id, `${c.code} - ${c.title}`]));
    
    // Mappa per associare i nomi ai record di corso
    const employeeNameMap = new Map(activeEmployees.map(e => [e.id, e.nominativo]));

    const criticalTraining = (training ?? [])
      .filter(t => employeeNameMap.has(t.employee_id))
      .map(t => ({
        lavoratore: employeeNameMap.get(t.employee_id)!,
        corso: courseMap.get(t.course_id) ?? `Corso #${t.course_id}`,
        scadenza: t.date_scadenza ?? "Da svolgere",
        stato: t.stato,
      }));

    // D. Caricamento criticità Sorveglianza Sanitaria
    const { data: medical } = await supabaseAdmin
      .from("medical_surveillance_records")
      .select("employee_id, data_scadenza, stato")
      .in("stato", ["scaduto", "in scadenza"]);

    const criticalMedical = (medical ?? [])
      .filter(m => employeeNameMap.has(m.employee_id))
      .map(m => ({
        lavoratore: employeeNameMap.get(m.employee_id)!,
        scadenza: m.data_scadenza ?? "N/A",
        stato: m.stato,
      }));

    // E. Caricamento anagrafica e assegnazione Mezzi / Flotta
    const [assetsRes, assignmentsRes] = await Promise.all([
      supabaseAdmin.from("fleet_assets").select("id, targa, marca, modello, status"),
      supabaseAdmin.from("fleet_asset_assignments").select("asset_id, employee_id").is("end_date", null),
    ]);

    const activeAssignments = new Map((assignmentsRes.data ?? []).map(a => [a.asset_id, a.employee_id]));

    const fleet = (assetsRes.data ?? []).map(a => ({
      mezzo: `${a.marca} ${a.modello} (${a.targa})`,
      stato: a.status,
      assegnatoA: employeeNameMap.get(activeAssignments.get(a.id) ?? 0) ?? "Disponibile",
    }));

    // F. Caricamento criticità DPI consegnati
    const { data: dpi } = await supabaseAdmin
      .from("dpi_employee_items")
      .select("employee_id, item_id, stato")
      .in("stato", ["da consegnare", "scaduto"]);

    const { data: dpiItems } = await supabaseAdmin.from("dpi_items").select("id, title");
    const dpiMap = new Map((dpiItems ?? []).map(d => [d.id, d.title]));

    const criticalDpi = (dpi ?? [])
      .filter(d => employeeNameMap.has(d.employee_id))
      .map(d => ({
        lavoratore: employeeNameMap.get(d.employee_id)!,
        dispositivo: dpiMap.get(d.item_id) ?? "Dispositivo",
        stato: d.stato,
      }));

    // 2. Costruzione del prompt di sistema con il contesto reale caricato
    const systemInstruction = `
Sei l'assistente virtuale di KONTROL, il sistema di gestione per la Cooperativa Morelli.
Rispondi in modo professionale, amichevole ed in italiano alle domande dei manager aziendali.
Usa esclusivamente i dati del database forniti qui sotto come base di conoscenza fidata. Se un'informazione non è presente in questo report, indicalo con gentilezza ed invita a consultare i rispettivi moduli.

STATO ATTUALE DEL GESTIONALE (REPORT REAL-TIME):

1. DIPENDENTI ATTIVI IN FORZA (Totale: ${activeEmployees.length}):
${JSON.stringify(activeEmployees, null, 2)}

2. CRITICITÀ FORMAZIONE E CORSI (Scaduti, in scadenza, o da fare):
${JSON.stringify(criticalTraining, null, 2)}

3. CRITICITÀ VISITE MEDICHE (Scadute o in scadenza):
${JSON.stringify(criticalMedical, null, 2)}

4. DOTAZIONE DPI DA REGOLARIZZARE (Da consegnare o scaduti):
${JSON.stringify(criticalDpi, null, 2)}

5. STATO FLOTTA MEZZI & VEICOLI (Assegnazioni attive):
${JSON.stringify(fleet, null, 2)}

ISTRUZIONI PER LE RISPOSTE:
- Fornisci risposte chiare, formattate in markdown, con elenchi puntati o tabelle per rendere i dati facili da leggere.
- Se l'utente ti chiede chi lavora in un determinato cantiere, elenca solo i lavoratori assegnati a quel cantiere nel report.
- Se ti chiede un consiglio o supporto per un dipendente (es. scadenze di Rossi), raggruppa tutti i suoi corsi e visite critiche presenti nel report.
- Non inventare dati (allucinazioni). Resta fedele a questo JSON.
    `.trim();

    // 3. Conversione della cronologia per l'API di Gemini
    const contents = [];
    
    // Aggiungiamo le istruzioni di sistema come primo messaggio utente o come parte della sessione
    contents.push({
      role: "user",
      parts: [{ text: systemInstruction }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "Ricevuto. Sono pronto ad assistere i manager di KONTROL basandomi sui dati reali del database. Come posso aiutarti oggi?" }],
    });

    // Aggiungi la cronologia dei messaggi successivi
    for (const msg of messages) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    // 4. Invocazione dell'API REST di Google Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API Error:", errorText);
      throw new Error(`Errore risposta assistente AI: ${geminiResponse.statusText}`);
    }

    const resJson = await geminiResponse.json();
    const answerText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!answerText) {
      throw new Error("L'assistente non ha restituito una risposta valida.");
    }

    return NextResponse.json({ text: answerText });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore elaborazione assistente virtuale." },
      { status: 500 }
    );
  }
}
