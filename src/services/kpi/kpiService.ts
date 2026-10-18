/**
 * Măsurarea celor 3 KPI de valoare — US-11 / FR-11 (Must), cu definițiile din fișa inițiativei:
 *
 *  KPI 1 · Rata de finalizare  = comenzi confirmate / sesiuni în care e inițiată finalizarea
 *                                 (o sesiune = o comandă)                      țintă ≥ 55%
 *  KPI 2 · Anulări integrale din lipsă de stoc = comenzi confirmate, apoi anulate integral
 *                                 din lipsă de stoc / comenzi confirmate      țintă ≤ 2%
 *  KPI 3 · Recumpărare în 60 de zile = clienți din cohortă cu o nouă comandă online ONORATĂ
 *                                 în 60 de zile de la prima comandă onorată / clienți unici
 *                                 cu cel puțin o comandă onorată              țintă ≥ 45%
 *
 * Cohortele sunt lunare. KPI 3 se raportează ca final doar când fereastra de 60 de zile
 * e urmărită integral pentru toată cohorta (BRD 1.9).
 * Indicatori de control alături de KPI: ponderea comenzilor cu înlocuire și timpul mediu de pregătire.
 */
import type { Clock } from "../../core/clock.js";
import { DAY } from "../../core/clock.js";
import type { DomainBus } from "../../domain/events.js";
import { MOTIV_LIPSA_STOC } from "../picking/pickingService.js";

export const FEREASTRA_RECUMPARARE = 60 * DAY;
export const TINTE = { finalizare: 0.55, anulari: 0.02, recumparare: 0.45 } as const;

export type EvenimentKpi =
  | { tip: "finalizare_initiata"; idSesiune: string; la: number }
  | { tip: "comanda_confirmata"; idSesiune: string; nrComanda: string; la: number }
  | { tip: "comanda_anulata_lipsa_stoc"; nrComanda: string; la: number }
  | { tip: "comanda_onorata"; nrComanda: string; idClient: string; la: number; cuInlocuire?: boolean; timpPregatireMs?: number };

export interface RaportKpi {
  luna: string;
  finalizare: { sesiuni: number; confirmate: number; rata: number | null; tinta: number; atinsa: boolean | null };
  anulari: { confirmate: number; anulateLipsaStoc: number; rata: number | null; tinta: number; atinsa: boolean | null };
  recumparare: {
    clienti: number;
    revenit: number;
    rata: number | null;
    tinta: number;
    atinsa: boolean | null;
    /** false = fereastra de 60 de zile nu s-a încheiat pentru toată cohorta: valoare provizorie. */
    fereastraCompleta: boolean;
  };
  control: { comenziOnorate: number; pondereInlocuiri: number | null; timpMediuPregatireMin: number | null };
}

export const lunaDin = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

export class KpiService {
  readonly evenimente: EvenimentKpi[] = [];
  /** coș → sesiunea de finalizare deschisă (o sesiune = o comandă) */
  private sesiuneDeschisa = new Map<string, string>();
  private nrSesiune = 0;

  constructor(private readonly clock: Clock, bus?: DomainBus) {
    bus?.on("comanda.status", ({ comanda, in: status, la, motiv }) => {
      if (status === "Confirmata") {
        const idSesiune = this.sesiuneDeschisa.get(comanda.idCos) ?? this.inceputFinalizare(comanda.idCos);
        this.sesiuneDeschisa.delete(comanda.idCos);
        this.inregistreaza({ tip: "comanda_confirmata", idSesiune, nrComanda: comanda.nrComanda, la });
      }
      if (status === "Anulata" && motiv === MOTIV_LIPSA_STOC) {
        this.inregistreaza({ tip: "comanda_anulata_lipsa_stoc", nrComanda: comanda.nrComanda, la });
      }
      if (status === "Onorata" && comanda.idClient) {
        const confirmata = comanda.istoric.find((h) => h.status === "Confirmata")?.la;
        const gata = comanda.istoric.find((h) => h.status === "GataDeRidicare" || h.status === "InLivrare")?.la;
        this.inregistreaza({
          tip: "comanda_onorata",
          nrComanda: comanda.nrComanda,
          idClient: comanda.idClient,
          la,
          cuInlocuire: comanda.linii.some((l) => l.inlocuire),
          timpPregatireMs: confirmata !== undefined && gata !== undefined ? gata - confirmata : undefined,
        });
      }
    });
  }

  /** Clientul a deschis pagina de finalizare. Aceeași sesiune până la confirmarea comenzii. */
  inceputFinalizare(idCos: string): string {
    const deschisa = this.sesiuneDeschisa.get(idCos);
    if (deschisa) return deschisa;
    const idSesiune = `S-${++this.nrSesiune}`;
    this.sesiuneDeschisa.set(idCos, idSesiune);
    this.inregistreaza({ tip: "finalizare_initiata", idSesiune, la: this.clock.now() });
    return idSesiune;
  }

  inregistreaza(e: EvenimentKpi): void {
    this.evenimente.push(e);
  }

  raport(luna: string): RaportKpi {
    const ev = this.evenimente;

    // KPI 1 — cohorta = luna în care a început sesiunea
    const sesiuni = new Map<string, number>();
    for (const e of ev) if (e.tip === "finalizare_initiata") sesiuni.set(e.idSesiune, e.la);
    const sesiuniLuna = [...sesiuni].filter(([, la]) => lunaDin(la) === luna).map(([id]) => id);
    const confirmatePeSesiune = new Set(ev.filter((e) => e.tip === "comanda_confirmata").map((e) => (e as { idSesiune: string }).idSesiune));
    const confirmateDinSesiuni = sesiuniLuna.filter((id) => confirmatePeSesiune.has(id)).length;

    // KPI 2 — cohorta = luna confirmării
    const confirmateLuna = ev.filter((e): e is Extract<EvenimentKpi, { tip: "comanda_confirmata" }> => e.tip === "comanda_confirmata" && lunaDin(e.la) === luna);
    const anulate = new Set(ev.filter((e) => e.tip === "comanda_anulata_lipsa_stoc").map((e) => (e as { nrComanda: string }).nrComanda));
    const anulateLuna = confirmateLuna.filter((c) => anulate.has(c.nrComanda)).length;

    // KPI 3 — cohorta = luna PRIMEI comenzi onorate a clientului
    const onorate = ev.filter((e): e is Extract<EvenimentKpi, { tip: "comanda_onorata" }> => e.tip === "comanda_onorata");
    const pePersoana = new Map<string, number[]>();
    for (const o of onorate) pePersoana.set(o.idClient, [...(pePersoana.get(o.idClient) ?? []), o.la]);
    let clienti = 0;
    let revenit = 0;
    let ultimaPrima = 0;
    for (const date of pePersoana.values()) {
      date.sort((a, b) => a - b);
      const prima = date[0];
      if (lunaDin(prima) !== luna) continue;
      clienti++;
      ultimaPrima = Math.max(ultimaPrima, prima);
      if (date.some((t) => t > prima && t - prima <= FEREASTRA_RECUMPARARE)) revenit++;
    }
    const fereastraCompleta = clienti > 0 && this.clock.now() >= sfarsitLuna(luna) + FEREASTRA_RECUMPARARE;

    // Indicatori de control
    const onorateLuna = onorate.filter((o) => lunaDin(o.la) === luna);
    const timpi = onorateLuna.map((o) => o.timpPregatireMs).filter((t): t is number => t !== undefined);

    const rata = (a: number, b: number) => (b ? a / b : null);
    const r1 = rata(confirmateDinSesiuni, sesiuniLuna.length);
    const r2 = rata(anulateLuna, confirmateLuna.length);
    const r3 = rata(revenit, clienti);
    return {
      luna,
      finalizare: { sesiuni: sesiuniLuna.length, confirmate: confirmateDinSesiuni, rata: r1, tinta: TINTE.finalizare, atinsa: r1 === null ? null : r1 >= TINTE.finalizare },
      anulari: { confirmate: confirmateLuna.length, anulateLipsaStoc: anulateLuna, rata: r2, tinta: TINTE.anulari, atinsa: r2 === null ? null : r2 <= TINTE.anulari },
      recumparare: { clienti, revenit, rata: r3, tinta: TINTE.recumparare, atinsa: r3 === null || !fereastraCompleta ? null : r3 >= TINTE.recumparare, fereastraCompleta },
      control: {
        comenziOnorate: onorateLuna.length,
        pondereInlocuiri: rata(onorateLuna.filter((o) => o.cuInlocuire).length, onorateLuna.length),
        timpMediuPregatireMin: timpi.length ? Math.round(timpi.reduce((s, t) => s + t, 0) / timpi.length / 60_000) : null,
      },
    };
  }
}

function sfarsitLuna(luna: string): number {
  const [an, l] = luna.split("-").map(Number);
  return Date.UTC(an, l, 1); // prima zi a lunii următoare
}
