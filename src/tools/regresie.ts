/**
 * Regresia TC-01–TC-15 (S8, criteriul de ieșire pentru Poarta 2): rulează toate testele și
 * afișează starea fiecărui caz de test din BRD (cap. 9.3), cu story-ul acoperit.
 *
 *   npm run regresie
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CAZURI: Record<string, string> = {
  "TC-01": "US-01", "TC-02": "US-01", "TC-03": "US-02", "TC-04": "US-03", "TC-05": "US-03",
  "TC-06": "US-04", "TC-07": "US-04", "TC-08": "US-05", "TC-09": "US-06", "TC-10": "US-07",
  "TC-11": "US-09", "TC-12": "US-08", "TC-13": "US-10", "TC-14": "US-11", "TC-15": "NFR-01",
};

interface Rezultat { fullName: string; status: string }

const out = path.join(mkdtempSync(path.join(tmpdir(), "regresie-")), "rezultate.json");
try {
  execFileSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`], { stdio: "ignore" });
} catch {
  // vitest iese cu cod ≠ 0 dacă un test pică; citim totuși rezultatele
}
const json = JSON.parse(readFileSync(out, "utf8")) as { numTotalTests: number; numFailedTests: number; testResults: { assertionResults: Rezultat[] }[] };
const toate = json.testResults.flatMap((f) => f.assertionResults);

const randuri = Object.entries(CAZURI).map(([tc, story]) => {
  const teste = toate.filter((t) => new RegExp(`${tc}[a-z]?\\b`).test(t.fullName));
  const stare = !teste.length ? "LIPSĂ" : teste.every((t) => t.status === "passed") ? "trecut" : "EȘUAT";
  return { "Caz de test": tc, Story: story, Teste: teste.length, Stare: stare };
});
console.table(randuri);

const esuate = randuri.filter((r) => r.Stare !== "trecut");
console.log(`Total teste: ${json.numTotalTests} · eșuate: ${json.numFailedTests}`);
if (esuate.length || json.numFailedTests) {
  console.log("Regresie EȘUATĂ — platforma NU e gata de pilot.");
  process.exit(1);
}
console.log("Regresie trecută: TC-01–TC-15, zero defecte deschise — gata de pilot (Poarta 2).");
