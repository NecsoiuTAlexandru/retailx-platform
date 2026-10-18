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
  /** Folosită pentru propunerea unui înlocuitor similar (US-09). */
  categorie?: string;
  /** Produs perisabil: exceptat de la retragerea în 14 zile (OUG 34/2014), cu excepția defectelor. */
  perisabil?: boolean;
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

export type TipPrimire = "livrare" | "ridicare";

export interface LinieComanda {
  codProdus: string;
  denumire: string;
  cantitate: number;
  pretUnitar: Bani;
  acceptaInlocuire: boolean;
  /** Rezultatul culegerii (S4): produs înlocuit sau linie eliminată. */
  inlocuire?: Inlocuire;
  eliminata?: boolean;
}

/** Clasa Înlocuire din diagrama de clase: cel mult una pe linie. */
export interface Inlocuire {
  codProdus: string;
  denumire: string;
  pretUnitar: Bani;
  motiv: string;
  diferentaRambursata: Bani;
}

export type StatusPlata = "initiata" | "autorizata" | "refuzata" | "rambursata";

export interface Plata {
  suma: Bani;
  status: StatusPlata;
  cheieIdempotenta: string;
  idTranzactie?: string;
  motiv?: string;
  la: number;
}

/** Costul total defalcat (FR-03): ce vede clientul înainte de butonul de plată. */
export interface Deviz {
  linii: { codProdus: string; denumire: string; cantitate: number; pretUnitar: Bani; total: Bani }[];
  produse: Bani;
  livrare: Bani;
  garantieSGR: Bani;
  ambalajeSGR: number;
  reduceri: { descriere: string; suma: Bani }[];
  total: Bani;
}

/**
 * Primire — clasa abstractă din diagrama de clase, specializată în
 * RidicareMagazin (codRidicare) și LivrareDomiciliu (adresă, AWB curier).
 */
export interface PrimireBaza {
  idInterval: string;
  /** Ex. „vin. 12.03 · 17:00–19:00” */
  interval: string;
  start: number;
  sfarsit: number;
}
export interface RidicareMagazin extends PrimireBaza {
  tip: "ridicare";
  codRidicare?: string;
  gataLa?: number;
}
export interface LivrareDomiciliu extends PrimireBaza {
  tip: "livrare";
  adresa: string;
  awbCurier?: string;
  linkUrmarire?: string;
}
export type Primire = RidicareMagazin | LivrareDomiciliu;

export interface Comanda {
  nrComanda: string;
  status: StatusComanda;
  idCos: string;
  idClient?: string;
  idMagazin: string;
  tipPrimire: TipPrimire;
  primire?: Primire;
  linii: LinieComanda[];
  deviz: Deviz;
  costTotal: Bani;
  plati: Plata[];
  rambursari?: { suma: Bani; motiv: string; la: number }[];
  /** Puncte de fidelitate folosite ca reducere (S5). */
  puncteFolosite?: number;
  rezervareId?: string;
  dataCrearii: number;
  dataConfirmarii?: number;
  istoric: { status: StatusComanda; la: number; motiv?: string }[];
}

export interface StocMagazin {
  idMagazin: string;
  codProdus: string;
  cantitate: number;
  /** Momentul ultimei confirmări primite din sistemul central (ms). */
  ultimaActualizare: number;
}
