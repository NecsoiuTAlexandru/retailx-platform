/**
 * Testul de încărcare pentru NFR-01: „95% din paginile de coș și plată se încarcă în sub 3 secunde
 * la 5 × traficul mediu”. Fiecare utilizator virtual face drumul complet de finalizare:
 * disponibilitate → adaugă în coș → cost total → intervale → plată.
 *
 * Rulare manuală pe serverul pornit:  npm run load -- --url http://localhost:3000 --utilizatori 250
 */
export interface RezultatIncarcare {
  cereri: number;
  erori: number;
  comenziConfirmate: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  pePas: Record<string, { p95Ms: number; cereri: number }>;
}

export interface OptiuniIncarcare {
  url: string;
  utilizatori: number;
  idMagazin?: string;
  codProdus?: string;
}

const percentila = (valori: number[], p: number) => {
  if (!valori.length) return 0;
  const s = [...valori].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export async function ruleazaIncarcare(o: OptiuniIncarcare): Promise<RezultatIncarcare> {
  const idMagazin = o.idMagazin ?? "PH-NORD";
  const codProdus = o.codProdus ?? "100310";
  const durate: Record<string, number[]> = {};
  let erori = 0;
  let comenziConfirmate = 0;

  async function cerere(pas: string, cale: string, metoda = "GET", corp?: unknown) {
    const t0 = performance.now();
    try {
      const r = await fetch(o.url + cale, {
        method: metoda,
        headers: { "content-type": "application/json" },
        body: corp === undefined ? undefined : JSON.stringify(corp),
      });
      const date = await r.json();
      if (!r.ok) erori++;
      return { ok: r.ok, date };
    } catch {
      erori++;
      return { ok: false, date: undefined };
    } finally {
      (durate[pas] ??= []).push(performance.now() - t0);
    }
  }

  async function utilizator(i: number) {
    const cos = `incarcare-${i}-${Math.random().toString(36).slice(2, 7)}`;
    await cerere("disponibilitate", `/api/produse/${codProdus}/disponibilitate?magazin=${idMagazin}`);
    await cerere("cos", `/api/cos/${cos}/magazin`, "PUT", { idMagazin });
    await cerere("cos", `/api/cos/${cos}/linii`, "POST", { codProdus, cantitate: 1 });
    const deviz = await cerere("deviz", `/api/cos/${cos}/deviz`, "POST", { tipPrimire: "ridicare" });
    const intervale = await cerere("intervale", `/api/magazine/${idMagazin}/intervale?tip=ridicare`);
    const interval = (intervale.date as { id: string; plin: boolean }[] | undefined)?.find((x) => !x.plin);
    const plata = await cerere("plata", `/api/cos/${cos}/plata`, "POST", {
      tipPrimire: "ridicare",
      idInterval: interval?.id,
      tokenCard: "tok_visa_ok",
      totalAfisat: (deviz.date as { total: number } | undefined)?.total,
      cheieIdempotenta: `${cos}-1`,
    });
    if (plata.ok && (plata.date as { status: string }).status === "Confirmata") comenziConfirmate++;
  }

  await Promise.all(Array.from({ length: o.utilizatori }, (_, i) => utilizator(i)));

  const toate = Object.values(durate).flat();
  return {
    cereri: toate.length,
    erori,
    comenziConfirmate,
    p50Ms: Math.round(percentila(toate, 50)),
    p95Ms: Math.round(percentila(toate, 95)),
    maxMs: Math.round(Math.max(0, ...toate)),
    pePas: Object.fromEntries(Object.entries(durate).map(([k, v]) => [k, { p95Ms: Math.round(percentila(v, 95)), cereri: v.length }])),
  };
}

// rulare din linia de comandă
if (process.argv[1]?.endsWith("loadTest.ts")) {
  const arg = (n: string, d: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  ruleazaIncarcare({ url: arg("url", "http://localhost:3000"), utilizatori: Number(arg("utilizatori", "250")) }).then((r) => {
    console.table(r.pePas);
    console.log(`cereri ${r.cereri} · erori ${r.erori} · comenzi confirmate ${r.comenziConfirmate} · p50 ${r.p50Ms} ms · p95 ${r.p95Ms} ms · max ${r.maxMs} ms`);
    console.log(r.p95Ms < 3000 ? "NFR-01 îndeplinit (p95 < 3 s)" : "NFR-01 NEÎNDEPLINIT (p95 ≥ 3 s)");
  });
}
