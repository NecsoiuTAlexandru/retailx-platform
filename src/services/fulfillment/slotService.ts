/**
 * Intervalele de livrare și de ridicare — US-06 / FR-06 (Must).
 *
 * Reguli:
 *  - intervale de 2 ore, între 08:00 și 20:00, pentru azi și mâine;
 *  - un interval poate fi ales doar dacă începe după timpul minim de pregătire (2 ore);
 *  - fiecare interval are o capacitate pe magazin; un interval plin NU poate fi ales (TC-09);
 *  - ridicarea e posibilă doar în magazinele care oferă ridicare.
 * Orele sunt ora magazinului (în prototip, ceasul platformei e tratat ca oră locală).
 */
import type { Clock } from "../../core/clock.js";
import { DAY, HOUR } from "../../core/clock.js";
import type { Magazin, TipPrimire } from "../../domain/model.js";

export const ORE_START = [8, 10, 12, 14, 16, 18];
export const DURATA_INTERVAL = 2 * HOUR;
export const TIMP_MINIM_PREGATIRE = 2 * HOUR;
export const CAPACITATE_IMPLICITA: Record<TipPrimire, number> = { ridicare: 8, livrare: 6 };

export interface IntervalDisponibil {
  id: string;
  idMagazin: string;
  tip: TipPrimire;
  start: number;
  sfarsit: number;
  eticheta: string;
  capacitate: number;
  ocupat: number;
  plin: boolean;
}

export class IntervalIndisponibilError extends Error {
  constructor(motiv: string) {
    super(motiv);
  }
}

const ZILE = ["dum.", "lun.", "mar.", "mie.", "joi", "vin.", "sâm."];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export class SlotService {
  /** id interval → comenzile care îl ocupă */
  private ocupare = new Map<string, Set<string>>();
  /** comandă → intervalul ocupat */
  private dupaComanda = new Map<string, string>();

  constructor(
    private readonly clock: Clock,
    private readonly magazine: Map<string, Magazin>,
    private readonly capacitate: Record<TipPrimire, number> = CAPACITATE_IMPLICITA,
  ) {}

  intervale(idMagazin: string, tip: TipPrimire, zile = 2): IntervalDisponibil[] {
    const m = this.magazine.get(idMagazin);
    if (!m || (tip === "ridicare" && !m.oferaRidicare)) return [];
    const now = this.clock.now();
    const azi = Math.floor(now / DAY) * DAY;
    const out: IntervalDisponibil[] = [];
    for (let z = 0; z < zile; z++) {
      for (const h of ORE_START) {
        const start = azi + z * DAY + h * HOUR;
        if (start < now + TIMP_MINIM_PREGATIRE) continue;
        out.push(this.descrie(idMagazin, tip, start));
      }
    }
    return out;
  }

  /** Verifică intervalul ales de client înainte de plată. */
  verifica(idInterval: string, idMagazin: string, tip: TipPrimire): IntervalDisponibil {
    const [m, t, startStr] = idInterval.split("|");
    const start = Number(startStr);
    if (m !== idMagazin || t !== tip || !Number.isFinite(start)) {
      throw new IntervalIndisponibilError("Intervalul nu corespunde magazinului sau modului de primire ales");
    }
    if (tip === "ridicare" && !this.magazine.get(idMagazin)?.oferaRidicare) {
      throw new IntervalIndisponibilError("Magazinul ales nu oferă ridicare");
    }
    if (start < this.clock.now() + TIMP_MINIM_PREGATIRE) {
      throw new IntervalIndisponibilError("Intervalul nu mai poate fi ales; alege unul mai târziu");
    }
    const i = this.descrie(idMagazin, tip, start);
    if (i.plin) throw new IntervalIndisponibilError("Intervalul ales este plin; alege alt interval");
    return i;
  }

  ocupa(idInterval: string, nrComanda: string): void {
    const s = this.ocupare.get(idInterval) ?? new Set<string>();
    s.add(nrComanda);
    this.ocupare.set(idInterval, s);
    this.dupaComanda.set(nrComanda, idInterval);
  }

  elibereaza(nrComanda: string): void {
    const id = this.dupaComanda.get(nrComanda);
    if (!id) return;
    this.ocupare.get(id)?.delete(nrComanda);
    this.dupaComanda.delete(nrComanda);
  }

  private descrie(idMagazin: string, tip: TipPrimire, start: number): IntervalDisponibil {
    const id = `${idMagazin}|${tip}|${start}`;
    const ocupat = this.ocupare.get(id)?.size ?? 0;
    const capacitate = this.capacitate[tip];
    const d = new Date(start);
    const h = d.getUTCHours();
    const zi = `${ZILE[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      id,
      idMagazin,
      tip,
      start,
      sfarsit: start + DURATA_INTERVAL,
      eticheta: `${zi} · ${hh(h)}–${hh(h + 2)}`,
      capacitate,
      ocupat,
      plin: ocupat >= capacitate,
    };
  }
}
