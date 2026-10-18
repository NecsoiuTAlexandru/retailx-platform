/**
 * API-ul REST folosit de website și de aplicația mobilă.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Platform } from "../platform.js";
import { StocInsuficientError } from "../services/stock/stockService.js";
import {
  CosGolError,
  DateLivrareLipsaError,
  PlataRefuzataError,
  TotalModificatError,
} from "../services/orders/orderService.js";
import { IntervalIndisponibilError } from "../services/fulfillment/slotService.js";
import { CodRidicareGresitError } from "../services/fulfillment/fulfillmentService.js";
import { TranzitieInvalidaError } from "../domain/orderState.js";
import { PuncteInsuficienteError } from "../services/loyalty/loyaltyService.js";
import { ReturRefuzatError } from "../services/returns/returnService.js";
import { ProdusNecunoscutError } from "../services/pricing/pricingService.js";

export function createApp(p: Platform) {
  const app = express();
  app.use(express.json());
  const here = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(here, "../../public")));

  // ---------- Catalog ----------
  app.get("/api/magazine", (_req, res) => res.json([...p.central.magazine.values()]));
  app.get("/api/produse", (_req, res) => res.json([...p.central.produse.values()]));

  // ---------- US-01: disponibilitate ----------
  app.get("/api/produse/:cod/disponibilitate", (req, res) => {
    const cod = req.params.cod;
    const ales = String(req.query.magazin ?? "PH-NORD");
    const toate = p.stock.disponibilitateToateMagazinele(cod);
    res.json({
      magazinAles: toate.find((d) => d.idMagazin === ales),
      alteMagazine: toate.filter((d) => d.idMagazin !== ales),
    });
  });

  // ---------- Coș și rezervare (US-02) ----------
  app.get("/api/cos/:id", (req, res) => res.json(p.cart.get(req.params.id)));
  app.put("/api/cos/:id/magazin", (req, res) => res.json(p.cart.setMagazin(req.params.id, req.body.idMagazin)));
  app.post("/api/cos/:id/linii", (req, res) =>
    res.json(p.cart.adauga(req.params.id, req.body.codProdus, Number(req.body.cantitate ?? 1))),
  );
  app.delete("/api/cos/:id/linii/:cod", (req, res) => res.json(p.cart.elimina(req.params.id, req.params.cod)));
  app.delete("/api/cos/:id", (req, res) => res.json(p.cart.goleste(req.params.id)));
  app.post("/api/cos/:id/rezervare", (req, res) => res.status(201).json(p.cart.rezerva(req.params.id)));

  // ---------- US-05: coș comun pe canale (clientul autentificat) ----------
  app.post("/api/clienti/:idClient/autentificare", (req, res) =>
    res.json(p.cart.autentifica(req.body.idCosAnonim, req.params.idClient)),
  );
  app.get("/api/clienti/:idClient/cos", (req, res) => {
    const canal = req.query.canal === "aplicatie" ? "aplicatie" : "website";
    res.json(p.cart.deschide(req.params.idClient, canal));
  });

  // ---------- US-06: intervale de livrare / ridicare ----------
  app.get("/api/magazine/:id/intervale", (req, res) => {
    const tip = req.query.tip === "livrare" ? "livrare" : "ridicare";
    res.json(p.slots.intervale(req.params.id, tip));
  });

  // ---------- Finalizarea comenzii (US-03, US-04) ----------
  app.post("/api/cos/:id/deviz", (req, res) => res.json(p.orders.deviz(req.params.id, req.body.tipPrimire ?? "ridicare")));
  app.post("/api/cos/:id/plata", (req, res) => {
    const c = p.orders.plaseaza(req.params.id, {
      tipPrimire: req.body.tipPrimire,
      idInterval: String(req.body.idInterval ?? ""),
      adresa: req.body.adresa,
      tokenCard: req.body.tokenCard,
      totalAfisat: Number(req.body.totalAfisat),
      cheieIdempotenta: String(req.body.cheieIdempotenta),
    });
    res.status(201).json(c);
  });
  app.get("/api/comenzi/:nr", (req, res) => {
    const c = p.orders.get(req.params.nr);
    if (!c) return res.status(404).json({ eroare: "Comanda nu există" });
    res.json(c);
  });

  // ---------- S4 · US-09: preferința de înlocuire și aplicația de culegere ----------
  app.put("/api/cos/:id/inlocuire", (req, res) => res.json(p.cart.seteazaInlocuire(req.params.id, Boolean(req.body.accepta))));
  app.get("/api/magazin/:id/de-cules", (req, res) => res.json(p.picking.deCules(req.params.id)));
  app.post("/api/magazin/comenzi/:nr/culegere", (req, res) => res.json(p.picking.culege(req.params.nr, req.body.rezultate ?? [])));

  // ---------- S4 · US-07: notificări și consimțăminte ----------
  app.get("/api/clienti/:idClient/notificari", (req, res) => res.json(p.notificari.pentru(req.params.idClient)));
  app.get("/api/clienti/:idClient/comenzi", (req, res) => res.json(p.orders.aleClientului(req.params.idClient)));
  app.get("/api/clienti/:idClient/consimtaminte", (req, res) => res.json(p.consent.ale(req.params.idClient)));
  app.put("/api/clienti/:idClient/consimtaminte/:tip", (req, res) => {
    const tip = req.params.tip === "recomandari" ? "recomandari" : "marketing";
    res.json(p.consent.seteaza(req.params.idClient, tip, Boolean(req.body.acordat)));
  });

  // ---------- S5 · US-08: cardul de fidelitate comun ----------
  app.get("/api/clienti/:idClient/card", (req, res) => {
    const profil = p.fidelitate.profil(req.params.idClient);
    if (!profil) return res.status(404).json({ eroare: "Clientul nu are card de fidelitate" });
    res.json({ profil, oferta: p.fidelitate.oferta(req.params.idClient) });
  });
  app.put("/api/cos/:id/puncte", (req, res) => {
    p.fidelitate.folosestePuncte(req.params.id, Number(req.body.puncte ?? 0));
    res.json(p.cart.get(req.params.id));
  });
  app.get("/api/clienti/:idClient/date-personale", (req, res) => res.json(p.fidelitate.exportaDate(req.params.idClient)));

  // ---------- S6 · US-10: retur din cont ----------
  app.get("/api/clienti/:idClient/retururi", (req, res) => res.json(p.retururi.aleClientului(req.params.idClient)));
  app.post("/api/clienti/:idClient/retururi", (req, res) => {
    const b = req.body;
    res.status(201).json(p.retururi.cere(req.params.idClient, b.nrComanda, b.linii ?? [], b.motiv, b.modReturnare, b.fotografie));
  });
  app.post("/api/magazin/retururi/:id/primit", (req, res) => res.json(p.retururi.primesteProdusul(req.params.id)));

  // ---------- S7 · US-11: KPI pe cohorta lunară ----------
  app.get("/api/kpi/:luna", (req, res) => {
    if (!/^\d{4}-\d{2}$/.test(req.params.luna)) return res.status(400).json({ eroare: "Luna are forma AAAA-LL" });
    res.json(p.kpi.raport(req.params.luna));
  });

  // ---------- Magazin: pregătire și predare ----------
  app.post("/api/magazin/comenzi/:nr/pregatire", (req, res) => res.json(p.fulfillment.incepePregatirea(req.params.nr)));
  app.post("/api/magazin/comenzi/:nr/gata", (req, res) => res.json(p.fulfillment.finalizeazaPregatirea(req.params.nr)));
  app.post("/api/magazin/comenzi/:nr/ridicare", (req, res) => res.json(p.fulfillment.ridica(req.params.nr, String(req.body.cod))));
  app.post("/api/curier/comenzi/:nr/livrata", (req, res) => res.json(p.fulfillment.confirmaLivrarea(req.params.nr)));

  // ---------- Simulări pentru demo (mediul de test) ----------
  app.post("/api/demo/vinde-la-casa", (req, res) => {
    res.json(p.central.vindeLaCasa(req.body.idMagazin, req.body.codProdus, Number(req.body.cantitate ?? 1)));
  });
  app.post("/api/demo/bon", (req, res) => {
    res.json(p.central.emiteBon(req.body.idMagazin, Number(req.body.suma), req.body.codCard));
  });
  app.post("/api/demo/sistem-central", (req, res) => {
    p.central.setOnline(Boolean(req.body.online));
    res.json({ online: p.central.isOnline() });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof StocInsuficientError) {
      return res.status(409).json({ eroare: err.message, lipsa: err.lipsa });
    }
    if (err instanceof TotalModificatError) {
      return res.status(409).json({ eroare: err.message, deviz: err.devizNou });
    }
    if (err instanceof PlataRefuzataError) {
      return res.status(402).json({ eroare: err.message, nrComanda: err.comanda.nrComanda });
    }
    if (err instanceof CosGolError || err instanceof DateLivrareLipsaError) return res.status(400).json({ eroare: err.message });
    if (err instanceof IntervalIndisponibilError) return res.status(409).json({ eroare: err.message });
    if (err instanceof CodRidicareGresitError) return res.status(403).json({ eroare: err.message });
    if (err instanceof TranzitieInvalidaError) return res.status(409).json({ eroare: err.message });
    if (err instanceof PuncteInsuficienteError) return res.status(400).json({ eroare: err.message });
    if (err instanceof ReturRefuzatError) return res.status(400).json({ eroare: err.message });
    if (err instanceof ProdusNecunoscutError) return res.status(404).json({ eroare: err.message });
    console.error(err);
    res.status(500).json({ eroare: "Eroare internă" });
  });

  return app;
}
