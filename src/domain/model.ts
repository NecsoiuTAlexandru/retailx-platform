/**
 * Modelul de domeniu RetailX (TO-BE) — după diagrama de clase din BRD, cap. 8.4.
 * Numele claselor și ale atributelor urmează diagrama, ca BA-ul și QA-ul să le regăsească.
 */
import type { Bani } from "../core/money.js";

export interface Produs {
  cod: string;
  denumire: string;
  pret: Bani;
  areGarantieSGR: boolean;
}

export interface Magazin {
  idMagazin: string;
  nume: string;
  oras: string;
  oferaRidicare: boolean;
}

/** Enumerarea StatusComandă (diagrama de stări, cap. 8.5). */
export type StatusComanda =
  | "InPlata"
  | "Confirmata"
  | "InPregatire"
  | "GataDeRidicare"
  | "InLivrare"
  | "Onorata"
  | "Anulata"
  | "Abandonata"
  | "Returnata";

export interface StocMagazin {
  idMagazin: string;
  codProdus: string;
  cantitate: number;
  /** Momentul ultimei confirmări primite din sistemul central (ms). */
  ultimaActualizare: number;
}
