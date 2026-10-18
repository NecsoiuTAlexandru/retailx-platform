# Istoric pe sprinturi

## S0 · Discovery (ian.–feb. 2027) — tag `s0`
Sprint Goal: Discovery aprobat; arhitectura de integrare testată la Poarta 1.

- Proiect Node.js + TypeScript, Express, Vitest.
- Model de domeniu inițial (Produs, Magazin, StocMagazin, StatusComandă).
- Simulatorul sistemului central: API de stoc cu limita de 1 apel/min/magazin, evenimente de vânzare, indisponibilitate.
- Test tehnic al integrării (`tests/s0-integration-spike.test.ts`) — riscul R2.
- Concluzie de arhitectură: interogările nu țin stocul sub 5 minute la 120 de magazine, deci platforma consumă **evenimente de vânzare**.
