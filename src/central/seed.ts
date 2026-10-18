/**
 * Date sintetice (BRD 9.1: „doar date sintetice”). Magazinele din pilotul de la Ploiești
 * și produsele din machetele din cap. 8.6.
 */
import { lei } from "../core/money.js";
import type { CentralSystemSimulator } from "./centralSystem.js";

export const MAGAZINE = [
  { idMagazin: "PH-NORD", nume: "RetailX Ploiești Nord", oras: "Ploiești", oferaRidicare: true },
  { idMagazin: "PH-SUD", nume: "RetailX Ploiești Sud", oras: "Ploiești", oferaRidicare: true },
  { idMagazin: "PH-CENTRU", nume: "RetailX Ploiești Centru", oras: "Ploiești", oferaRidicare: true },
  { idMagazin: "CAMPINA", nume: "RetailX Câmpina", oras: "Câmpina", oferaRidicare: false },
];

export const PRODUSE = [
  { cod: "100245", denumire: "Lapte integral 3,5% grăsime, 1 L", pret: lei(8.49), areGarantieSGR: true, categorie: "lapte" },
  { cod: "100310", denumire: "Apă plată 2 L", pret: lei(3.2), areGarantieSGR: true, categorie: "apa" },
  { cod: "100512", denumire: "Iaurt grecesc 400 g", pret: lei(9.79), areGarantieSGR: false, categorie: "iaurt-grecesc" },
  { cod: "100513", denumire: "Iaurt grecesc 380 g", pret: lei(8.99), areGarantieSGR: false, categorie: "iaurt-grecesc" },
  { cod: "100720", denumire: "Pâine albă 500 g", pret: lei(5.49), areGarantieSGR: false, categorie: "paine" },
  { cod: "200871", denumire: "Fierbător electric 1,7 L", pret: lei(119.99), areGarantieSGR: false, categorie: "electrocasnice" },
];

export function seedCentral(central: CentralSystemSimulator): void {
  MAGAZINE.forEach((m) => central.addMagazin(m));
  PRODUSE.forEach((p) => central.addProdus(p));
  const stoc: Record<string, Record<string, number>> = {
    "PH-NORD": { "100245": 14, "100310": 40, "100512": 6, "100513": 10, "100720": 25, "200871": 4 },
    "PH-SUD": { "100245": 9, "100310": 30, "100512": 3, "100513": 0, "100720": 12, "200871": 2 },
    "PH-CENTRU": { "100245": 0, "100310": 18, "100512": 5, "100513": 7, "100720": 0, "200871": 1 },
    CAMPINA: { "100245": 7, "100310": 22, "100512": 4, "100513": 4, "100720": 10, "200871": 3 },
  };
  for (const [m, produse] of Object.entries(stoc)) {
    for (const [cod, q] of Object.entries(produse)) central.setStoc(m, cod, q);
  }
}
