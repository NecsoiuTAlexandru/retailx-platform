# Istoric pe sprinturi

## S0 · Discovery (ian.–feb. 2027) — tag `s0`
Sprint Goal: Discovery aprobat; arhitectura de integrare testată la Poarta 1.

- Proiect Node.js + TypeScript, Express, Vitest.
- Model de domeniu inițial (Produs, Magazin, StocMagazin, StatusComandă).
- Simulatorul sistemului central: API de stoc cu limita de 1 apel/min/magazin, evenimente de vânzare, indisponibilitate.
- Test tehnic al integrării (`tests/s0-integration-spike.test.ts`) — riscul R2.
- Concluzie de arhitectură: interogările nu țin stocul sub 5 minute la 120 de magazine, deci platforma consumă **evenimente de vânzare**.

## S1 · 1–12 martie 2027 — tag `s1`
Sprint Goal: „Clientul vede stocul real și produsul i se rezervă la plată.” (US-01 8 SP, US-02 5 SP)

- Conectorul de stoc: încărcare inițială prin API + consumul evenimentelor de vânzare și heartbeat (decizia din 8 martie).
- Memoria cache de stoc pe magazin; stoc de siguranță de 2 bucăți.
- Eticheta de disponibilitate: „în stoc” / „indisponibil” / „disponibilitate neconfirmată” peste 5 minute (BR-04).
- Serviciul de rezervare pe 15 minute, totul-sau-nimic; anularea la golirea coșului.
- API REST și pagina de produs (website) cu disponibilitatea în alte magazine și cronometrul rezervării.
- Teste: TC-01a, TC-02, TC-03a/b/c trecute. **TC-01b eșuat → DEF-01** (12 min la vârf, procesare secvențială), marcat `it.fails`.
- Decizia PO: US-02 acceptat; US-01 trece în S2 cu prioritate maximă.
