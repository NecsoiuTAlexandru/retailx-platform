/**
 * Ceasul platformei. Toate regulile cu timp (stoc ≤ 5 min, rezervare 15 min,
 * fereastra de 60 de zile) folosesc acest ceas, ca testele să poată „avansa timpul”.
 */
export interface Clock {
  now(): number;
}

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  constructor(private t: number = Date.UTC(2027, 2, 1, 7, 0, 0)) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}
