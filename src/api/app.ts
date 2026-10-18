/**
 * API-ul REST folosit de website și de aplicația mobilă.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Platform } from "../platform.js";
import { StocInsuficientError } from "../services/stock/stockService.js";
import { CosGolError, PlataRefuzataError, TotalModificatError } from "../services/orders/orderService.js";
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

  // ---------- Finalizarea comenzii (US-03, US-04) ----------
  app.post("/api/cos/:id/deviz", (req, res) => res.json(p.orders.deviz(req.params.id, req.body.tipPrimire ?? "ridicare")));
  app.post("/api/cos/:id/plata", (req, res) => {
    const c = p.orders.plaseaza(req.params.id, {
      tipPrimire: req.body.tipPrimire,
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

  // ---------- Simulări pentru demo (mediul de test) ----------
  app.post("/api/demo/vinde-la-casa", (req, res) => {
    res.json(p.central.vindeLaCasa(req.body.idMagazin, req.body.codProdus, Number(req.body.cantitate ?? 1)));
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
    if (err instanceof CosGolError) return res.status(400).json({ eroare: err.message });
    if (err instanceof ProdusNecunoscutError) return res.status(404).json({ eroare: err.message });
    console.error(err);
    res.status(500).json({ eroare: "Eroare internă" });
  });

  return app;
}
