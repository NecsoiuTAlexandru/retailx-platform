/**
 * Sprint 0 — test tehnic al integrării cu sistemul central (riscul R2, Poarta 1).
 * Răspunde la întrebările de arhitectură înainte de S1.
 */
import { FakeClock, MINUTE, SECOND } from "../src/core/clock.js";
import {
  CentralSystemSimulator,
  CentralUnavailableError,
  RateLimitError,
  type SaleEvent,
} from "../src/central/centralSystem.js";
import { seedCentral } from "../src/central/seed.js";

describe("S0 · test tehnic al integrării cu sistemul central", () => {
  let clock: FakeClock;
  let central: CentralSystemSimulator;

  beforeEach(() => {
    clock = new FakeClock();
    central = new CentralSystemSimulator(clock);
    seedCentral(central);
  });

  it("citește stocul unui magazin prin API", () => {
    const stoc = central.getStocMagazin("PH-NORD");
    expect(stoc.find((s) => s.codProdus === "100245")?.cantitate).toBe(14);
  });

  it("API-ul permite un singur apel pe minut pentru fiecare magazin", () => {
    central.getStocMagazin("PH-NORD");
    clock.advance(30 * SECOND);
    expect(() => central.getStocMagazin("PH-NORD")).toThrow(RateLimitError);
    // alt magazin are propria limită
    expect(() => central.getStocMagazin("PH-SUD")).not.toThrow();
    clock.advance(30 * SECOND);
    expect(() => central.getStocMagazin("PH-NORD")).not.toThrow();
  });

  it("emite evenimente de vânzare de la casă", () => {
    const primite: SaleEvent[] = [];
    central.onSale((e) => primite.push(e));
    central.vindeLaCasa("PH-NORD", "100245", 2);
    expect(primite).toHaveLength(1);
    expect(primite[0]).toMatchObject({ idMagazin: "PH-NORD", codProdus: "100245", cantitate: 2 });
    expect(central.stocReal("PH-NORD", "100245")).toBe(12);
  });

  it("când sistemul central cade, API-ul semnalează indisponibilitatea, iar evenimentele se livrează la revenire", () => {
    const primite: SaleEvent[] = [];
    central.onSale((e) => primite.push(e));
    central.setOnline(false);
    expect(() => central.getStocMagazin("PH-SUD")).toThrow(CentralUnavailableError);
    central.vindeLaCasa("PH-SUD", "100310");
    expect(primite).toHaveLength(0);
    central.setOnline(true);
    expect(primite).toHaveLength(1);
  });
});
