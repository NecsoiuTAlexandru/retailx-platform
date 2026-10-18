/**
 * Sumele se țin în bani (1 leu = 100 bani), ca întregi, ca să nu apară erori de rotunjire:
 * „suma afișată = suma debitată” (BR-04) trebuie să fie egalitate exactă.
 */
export type Bani = number;

export const lei = (value: number): Bani => Math.round(value * 100);

export const formatLei = (b: Bani): string =>
  `${(b / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;

/** Garanția SGR: 0,50 lei / ambalaj (din 30 noiembrie 2023). */
export const SGR_PER_AMBALAJ: Bani = lei(0.5);
