// Lê docs/data/libraries.json, visita cada link da Ads Library com um navegador
// headless, extrai o número de anúncios exibido pela Meta e acumula o histórico
// em docs/data/history.json. Pensado para rodar via GitHub Actions (cron) ou
// manualmente com `npm run scrape`.

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const LIBRARIES_PATH = path.join("docs", "data", "libraries.json");
const HISTORY_PATH = path.join("docs", "data", "history.json");

const RESULTS_TEXT_RE = /(mais de|more than)?\s*[~≈]?\s*([\d.,]+)\s*(resultados?|results?)/i;

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function extractCount(text) {
  const match = text.match(RESULTS_TEXT_RE);
  if (!match) return null;
  const approx = Boolean(match[1]) || text.includes("~") || text.includes("≈");
  const digits = match[2].replace(/[^\d]/g, "");
  if (!digits) return null;
  return { count: parseInt(digits, 10), approx };
}

async function scrapeOne(browser, lib) {
  const page = await browser.newPage({ locale: "pt-BR" });
  try {
    await page.goto(lib.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // A biblioteca de anúncios é montada via JS; espera o bloco de resultados aparecer.
    const locator = page.getByText(/resultados?|results?/i).first();
    await locator.waitFor({ timeout: 30000 });
    const text = (await locator.innerText()).replace(/\s+/g, " ").trim();
    const parsed = extractCount(text);
    if (!parsed) {
      return { ok: false, error: `Não consegui interpretar o texto de resultados: "${text}"` };
    }
    return { ok: true, count: parsed.count, approx: parsed.approx, raw: text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await page.close();
  }
}

function upsertSnapshot(entry, snapshot) {
  // Se já existe um snapshot de hoje, substitui (mantém só o mais recente do dia)
  // em vez de acumular várias entradas por dia quando o workflow roda mais de uma vez.
  const idx = entry.snapshots.findIndex((s) => s.date === snapshot.date);
  if (idx >= 0) {
    entry.snapshots[idx] = snapshot;
  } else {
    entry.snapshots.push(snapshot);
  }
  entry.snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const libraries = readJson(LIBRARIES_PATH, []);
  const history = readJson(HISTORY_PATH, {});

  if (libraries.length === 0) {
    console.log("Nenhuma biblioteca cadastrada em docs/data/libraries.json ainda. Nada a fazer.");
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
    return;
  }

  const browser = await chromium.launch();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  let ok = 0;
  let failed = 0;

  for (const lib of libraries) {
    process.stdout.write(`Consultando "${lib.name}"... `);
    const result = await scrapeOne(browser, lib);

    if (!history[lib.id]) {
      history[lib.id] = { name: lib.name, url: lib.url, snapshots: [], lastError: null };
    }
    const entry = history[lib.id];
    entry.name = lib.name;
    entry.url = lib.url;

    if (result.ok) {
      upsertSnapshot(entry, {
        date: today,
        timestamp: now,
        count: result.count,
        approx: result.approx,
      });
      entry.lastError = null;
      ok += 1;
      console.log(`${result.count} anúncios${result.approx ? " (aprox.)" : ""}`);
    } else {
      entry.lastError = { message: result.error, timestamp: now };
      failed += 1;
      console.log(`ERRO — ${result.error}`);
    }

    // Delay educado entre requisições para reduzir risco de bloqueio.
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
  }

  await browser.close();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  console.log(`\nConcluído: ${ok} atualizadas, ${failed} com erro.`);
}

main().catch((err) => {
  console.error("Falha inesperada no scraper:", err);
  process.exit(1);
});
