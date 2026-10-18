/**
 * Simulatorul firmei de curierat (actor extern de tip sistem, diagrama use case).
 * Creează AWB-ul la predarea coletului și confirmă livrarea.
 */
export interface Colet {
  awb: string;
  nrComanda: string;
  adresa: string;
  linkUrmarire: string;
  livrat: boolean;
}

export class CourierSimulator {
  private colete = new Map<string, Colet>();
  private next = 5_000_001;

  preiaColet(nrComanda: string, adresa: string): Colet {
    const awb = `AWB${this.next++}`;
    const c: Colet = { awb, nrComanda, adresa, linkUrmarire: `https://curier.example/urmarire/${awb}`, livrat: false };
    this.colete.set(awb, c);
    return c;
  }

  get(awb: string): Colet | undefined {
    return this.colete.get(awb);
  }

  marcheazaLivrat(awb: string): Colet {
    const c = this.colete.get(awb);
    if (!c) throw new Error(`AWB necunoscut: ${awb}`);
    c.livrat = true;
    return c;
  }
}
