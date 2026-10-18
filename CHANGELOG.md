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

## S2 — tag `s2`
Sprint Goal: „Costul total e clar și plata nu pierde coșul.” (US-03 5 SP, US-04 8 SP + DEF-01)

- **DEF-01 remediat**: evenimentele se procesează în paralel, câte o bandă pe magazin (ordinea se păstrează în magazin). Retest TC-01b trecut.
- Calculul costului total (produse + livrare + SGR − reduceri), prețuri luate doar din catalog; livrare 15 lei sub pragul de 200 lei.
- Simulator de procesator de plăți: 3-D Secure, carduri de test, idempotență, căderea conexiunii după debitare.
- Serviciul Comenzi după diagrama de secvență: rezervare → autorizare → „Confirmată”; plata refuzată eliberează rezervarea și păstrează coșul.
- Mașina de stări a comenzii (diagrama de stări, cap. 8.5).
- Website: rezumatul costului și plata cu carduri de test.
- Teste: TC-04, TC-05, TC-06, TC-07 + retest TC-01b. Decizia PO: US-01, US-03, US-04 acceptate.
