/**
 * Sprint 7 — „KPI-urile se măsoară corect și platforma rezistă la vârf.”
 * US-11 (8 SP), NFR-01 (5 SP).
 */
import type { AddressInfo } from "node:net";
import { DAY, FakeClock, SystemClock } from "../src/core/clock.js";
import { createApp } from "../src/api/app.js";
import { createPlatform } from "../src/platform.js";
import { KpiService } from "../src/services/kpi/kpiService.js";
import { ruleazaIncarcare } from "../src/tools/loadTest.js";
import { comandaPlatita, platformaDeTest } from "./helpers.js";

describe("US-11 · cei 3 KPI cu definițiile din fișa inițiativei", () => {
  it("TC-14 · 50 de sesiuni, 22 de comenzi, 1 anulată din lipsă de stoc; recumpărare după 59 și după 62 de zile", () => {
    const start = Date.UTC(2028, 0, 5); // cohorta ianuarie 2028
    const clock = new FakeClock(start);
    const kpi = new KpiService(clock);

    for (let i = 1; i <= 50; i++) kpi.inregistreaza({ tip: "finalizare_initiata", idSesiune: `S${i}`, la: start + i * 60_000 });
    for (let i = 1; i <= 22; i++) {
      kpi.inregistreaza({ tip: "comanda_confirmata", idSesiune: `S${i}`, nrComanda: `C${i}`, la: start + i * 60_000 + 5_000 });
    }
    kpi.inregistreaza({ tip: "comanda_anulata_lipsa_stoc", nrComanda: "C22", la: start + DAY });
    // 21 de comenzi onorate, fiecare a altui client
    for (let i = 1; i <= 21; i++) kpi.inregistreaza({ tip: "comanda_onorata", nrComanda: `C${i}`, idClient: `client${i}`, la: start + DAY });
    // client1 revine după 59 de zile (se numără), client2 după 62 (nu se numără)
    kpi.inregistreaza({ tip: "comanda_onorata", nrComanda: "C-R1", idClient: "client1", la: start + DAY + 59 * DAY });
    kpi.inregistreaza({ tip: "comanda_onorata", nrComanda: "C-R2", idClient: "client2", la: start + DAY + 62 * DAY });

    clock.set(Date.UTC(2028, 3, 1)); // 1 aprilie: fereastra cohortei din ianuarie e completă
    const r = kpi.raport("2028-01");
    expect(r.finalizare).toMatchObject({ sesiuni: 50, confirmate: 22, rata: 0.44, atinsa: false });
    expect(r.anulari).toMatchObject({ confirmate: 22, anulateLipsaStoc: 1 });
    expect(r.anulari.rata).toBeCloseTo(1 / 22);
    expect(r.recumparare).toMatchObject({ clienti: 21, revenit: 1, fereastraCompleta: true });
  });

  it("recumpărarea e provizorie cât timp fereastra de 60 de zile nu s-a încheiat", () => {
    const start = Date.UTC(2028, 0, 10);
    const clock = new FakeClock(start);
    const kpi = new KpiService(clock);
    kpi.inregistreaza({ tip: "comanda_onorata", nrComanda: "C1", idClient: "a", la: start });
    clock.set(Date.UTC(2028, 2, 1));
    const r = kpi.raport("2028-01");
    expect(r.recumparare.fereastraCompleta).toBe(false);
    expect(r.recumparare.atinsa).toBeNull();
  });

  it("evenimentele vin direct din platformă: sesiune la deschiderea finalizării, confirmare, onorare, anulare din lipsă de stoc", () => {
    const { clock, p } = platformaDeTest();
    // client care finalizează
    const cos = p.cart.autentifica(undefined, "ana").id;
    p.cart.adauga(cos, "100245");
    const c = comandaPlatita(p, cos);
    p.picking.culege(c.nrComanda);
    p.fulfillment.ridica(c.nrComanda, c.primire!.tip === "ridicare" ? c.primire!.codRidicare! : "");
    // client care deschide finalizarea și abandonează
    p.cart.adauga("abandon", "100720");
    p.orders.deviz("abandon", "ridicare");
    p.orders.deviz("abandon", "livrare"); // aceeași sesiune
    // comandă anulată integral din lipsă de stoc
    p.cart.adauga("lipsa", "100720");
    const c3 = comandaPlatita(p, "lipsa");
    p.picking.culege(c3.nrComanda, [{ codProdus: "100720", gasit: 0 }]);

    const r = p.kpi.raport(new Date(clock.now()).toISOString().slice(0, 7));
    expect(r.finalizare).toMatchObject({ sesiuni: 3, confirmate: 2 });
    expect(r.anulari).toMatchObject({ confirmate: 2, anulateLipsaStoc: 1 });
    expect(r.recumparare.clienti).toBe(1);
    expect(r.control.comenziOnorate).toBe(1);
  });
});

describe("NFR-01 · performanța la vârf", () => {
  it("TC-15 · test de încărcare la 5 × traficul mediu: 95% din cereri sub 3 s, nicio comandă pierdută", async () => {
    // 5 × traficul mediu = 250 de clienți care finalizează simultan (ipoteză de lucru din S0)
    const p = createPlatform({ clock: new SystemClock(), incarca: false, capacitateIntervale: { ridicare: 1000, livrare: 1000 } });
    p.central.setStoc("PH-NORD", "100310", 10_000);
    p.stock.incarcaInitial();
    const server = createApp(p).listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const r = await ruleazaIncarcare({ url: `http://127.0.0.1:${port}`, utilizatori: 250 });
      expect(r.erori).toBe(0);
      expect(r.p95Ms).toBeLessThan(3000);
      expect(r.comenziConfirmate).toBe(250);
      // nicio comandă pierdută sau dublată: o debitare pentru fiecare comandă confirmată
      expect(p.orders.toate().filter((c) => c.status === "Confirmata")).toHaveLength(250);
      expect(p.procesator.debitari).toHaveLength(250);
    } finally {
      server.close();
    }
  });
});
