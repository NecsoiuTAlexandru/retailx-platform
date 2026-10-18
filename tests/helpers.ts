import { FakeClock } from "../src/core/clock.js";
import { lei } from "../src/core/money.js";
import type { CentralSystemSimulator } from "../src/central/centralSystem.js";
import { createPlatform } from "../src/platform.js";

/**
 * Platformă cu datele sintetice standard și ceas controlat de test.
 * `ajustari` modifică stocul din sistemul central înainte de încărcarea inițială.
 */
export function platformaDeTest(ajustari?: (central: CentralSystemSimulator) => void) {
  const clock = new FakeClock();
  const p = createPlatform({ clock, incarca: false });
  ajustari?.(p.central);
  p.stock.incarcaInitial();
  return { clock, p };
}

/** Trece timpul minut cu minut, cu heartbeat-ul sistemului central (ca în producție). */
export function treceTimp(clock: FakeClock, p: { central: CentralSystemSimulator }, ms: number) {
  const MIN = 60_000;
  let ramas = ms;
  while (ramas > 0) {
    const pas = Math.min(MIN, ramas);
    clock.advance(pas);
    p.central.heartbeat();
    ramas -= pas;
  }
  clock.advance(1_000); // heartbeat-ul se procesează
}

/**
 * Platformă pentru testul de vârf: N magazine, fiecare cu produsul „P-TEST” (3 bucăți)
 * și câteva produse de umplutură.
 */
export function platformaLaScara(nrMagazine: number) {
  const clock = new FakeClock();
  const p = createPlatform({ clock, seed: false, incarca: false });
  for (let i = 1; i <= nrMagazine; i++) {
    const id = `M${String(i).padStart(3, "0")}`;
    p.central.addMagazin({ idMagazin: id, nume: `RetailX ${id}`, oras: "Test", oferaRidicare: true });
    p.central.setStoc(id, "P-TEST", 3);
    for (let f = 0; f < 9; f++) p.central.setStoc(id, `F-${f}`, 50);
  }
  p.central.addProdus({ cod: "P-TEST", denumire: "Produs test", pret: lei(10), areGarantieSGR: false });
  for (let f = 0; f < 9; f++) p.central.addProdus({ cod: `F-${f}`, denumire: `Umplutură ${f}`, pret: lei(5), areGarantieSGR: false });
  p.stock.incarcaInitial();
  return { clock, p };
}
