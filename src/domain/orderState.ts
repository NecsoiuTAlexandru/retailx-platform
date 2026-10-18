/**
 * Ciclul de viață al comenzii — diagrama de stări din BRD, cap. 8.5.
 * Orice schimbare de status trece pe aici; o tranziție care nu e în diagramă e o eroare.
 */
import type { Comanda, StatusComanda } from "./model.js";

export const TRANZITII: Record<StatusComanda, StatusComanda[]> = {
  // plata refuzată nu scoate comanda din „În plată” (reîncercare)
  InPlata: ["Confirmata", "Abandonata"],
  // clientul anulează înainte de pregătire → rambursare integrală
  Confirmata: ["InPregatire", "Anulata"],
  // stare compusă: culegere → înlocuire / eliminare linie → ambalare.
  // „Anulata” doar dacă TOATE liniile lipsesc (ce măsoară KPI 2).
  InPregatire: ["GataDeRidicare", "InLivrare", "Anulata"],
  // neridicată în 48 h → rambursare
  GataDeRidicare: ["Onorata", "Anulata"],
  InLivrare: ["Onorata"],
  // retur aprobat → rambursare
  Onorata: ["Returnata"],
  Anulata: [],
  Abandonata: [],
  Returnata: [],
};

export class TranzitieInvalidaError extends Error {
  constructor(din: StatusComanda, in_: StatusComanda) {
    super(`Tranziție invalidă: ${din} → ${in_}`);
  }
}

export function schimbaStatus(c: Comanda, nou: StatusComanda, la: number, motiv?: string): void {
  if (!TRANZITII[c.status].includes(nou)) throw new TranzitieInvalidaError(c.status, nou);
  c.status = nou;
  c.istoric.push({ status: nou, la, motiv });
}
