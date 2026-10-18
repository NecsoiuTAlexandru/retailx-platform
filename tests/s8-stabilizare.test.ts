/**
 * Sprint 8 — „Platforma e gata de pilot.” Stabilizare: remedieri găsite la regresie,
 * validarea intrărilor în API și monitorizare. Regresia completă TC-01–TC-15: `npm run regresie`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/api/app.js";
import { ValidareError } from "../src/core/errors.js";
import { cererePlata, platformaDeTest } from "./helpers.js";

describe("S8 · remedieri găsite la regresie", () => {
  it("un produs adăugat după inițierea plății e rezervat și el (rezervarea veche nu mai e refolosită)", () => {
    const { p } = platformaDeTest((c) => c.setStoc("PH-NORD", "200871", 3)); // o singură bucată online
    p.cart.adauga("A", "100245");
    p.cart.rezerva("A"); // „Inițiază plata” (fluxul din S1)
    p.cart.adauga("A", "200871"); // apoi mai adaugă un produs
    p.cart.adauga("B", "200871");
    p.orders.plaseaza("A", cererePlata(p, "A"));
    // ultima bucată e alocată lui A; B nu o mai poate rezerva
    expect(p.stock.disponibilitate("PH-NORD", "200871").disponibil).toBe(0);
    expect(() => p.cart.rezerva("B")).toThrow();
  });

  it("schimbarea magazinului după inițierea plății eliberează rezervarea din magazinul vechi", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100245", 5);
    p.cart.rezerva("A");
    expect(p.stock.disponibilitate("PH-NORD", "100245").disponibil).toBe(7);
    p.cart.setMagazin("A", "PH-SUD");
    expect(p.stock.disponibilitate("PH-NORD", "100245").disponibil).toBe(12);
    const c = p.orders.plaseaza("A", cererePlata(p, "A"));
    expect(c.idMagazin).toBe("PH-SUD");
    expect(p.stock.disponibilitate("PH-SUD", "100245").disponibil).toBe(2);
  });

  it("cantitățile invalide sunt refuzate în coș", () => {
    const { p } = platformaDeTest();
    expect(() => p.cart.adauga("A", "100245", 0)).toThrow(ValidareError);
    expect(() => p.cart.adauga("A", "100245", 1.5)).toThrow(ValidareError);
    expect(() => p.cart.adauga("A", "100245", 500)).toThrow(ValidareError);
  });
});

describe("S8 · API robust pentru pilot", () => {
  let server: Server;
  let url: string;
  beforeAll(() => {
    const { p } = platformaDeTest();
    server = createApp(p).listen(0);
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (cale: string, corp: string) =>
    fetch(url + cale, { method: "POST", headers: { "content-type": "application/json" }, body: corp });

  it("comanda inexistentă → 404 cu mesaj clar", async () => {
    const r = await fetch(`${url}/api/comenzi/RX-0`);
    expect(r.status).toBe(404);
    const r2 = await post("/api/magazin/comenzi/RX-0/pregatire", "{}");
    expect(r2.status).toBe(404);
    expect((await r2.json()).eroare).toContain("nu există");
  });

  it("produs necunoscut sau cantitate invalidă → 404 / 400, nu 500", async () => {
    expect((await post("/api/cos/x/linii", JSON.stringify({ codProdus: "NU-EXISTA" }))).status).toBe(404);
    expect((await post("/api/cos/x/linii", JSON.stringify({ codProdus: "100245", cantitate: "abc" }))).status).toBe(400);
  });

  it("JSON invalid → 400; rută necunoscută → 404", async () => {
    expect((await post("/api/cos/x/linii", "{nu e json")).status).toBe(400);
    expect((await fetch(`${url}/api/nu-exista`)).status).toBe(404);
  });

  it("endpointul de sănătate raportează sistemul central și coada de evenimente", async () => {
    const r = await (await fetch(`${url}/api/sanatate`)).json();
    expect(r).toMatchObject({ status: "ok", sistemCentral: "online", evenimenteInAsteptare: 0 });
  });
});
