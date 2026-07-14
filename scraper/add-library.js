// Utilitário de linha de comando para cadastrar uma nova biblioteca de anúncios.
// Uso: npm run add -- "Nome do produto" "https://www.facebook.com/ads/library/?...&view_all_page_id=123..."

import fs from "fs";
import path from "path";

const LIBRARIES_PATH = path.join("docs", "data", "libraries.json");

const [, , name, url] = process.argv;

if (!name || !url) {
  console.error(
    'Uso: npm run add -- "Nome do produto" "https://www.facebook.com/ads/library/?...&view_all_page_id=123..."'
  );
  process.exit(1);
}

function slugify(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function extractPageId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.searchParams.get("view_all_page_id");
  } catch {
    return null;
  }
}

function readLibraries() {
  if (!fs.existsSync(LIBRARIES_PATH)) return [];
  const raw = fs.readFileSync(LIBRARIES_PATH, "utf-8").trim();
  return raw ? JSON.parse(raw) : [];
}

const pageId = extractPageId(url);
if (!pageId) {
  console.warn(
    'Aviso: não encontrei "view_all_page_id" no link. Confira se você copiou a URL completa ' +
      "da barra de endereços enquanto estava vendo os anúncios de um anunciante específico na Ads Library."
  );
}

const libraries = readLibraries();

const baseId = slugify(name) || "biblioteca";
let id = baseId;
let suffix = 1;
const existingIds = new Set(libraries.map((l) => l.id));
while (existingIds.has(id)) {
  suffix += 1;
  id = `${baseId}-${suffix}`;
}

libraries.push({ id, name, url, pageId });

fs.mkdirSync(path.dirname(LIBRARIES_PATH), { recursive: true });
fs.writeFileSync(LIBRARIES_PATH, JSON.stringify(libraries, null, 2) + "\n");

console.log(`Adicionado "${name}" (id: ${id}).`);
console.log('Agora faça: git add docs/data/libraries.json && git commit -m "add: nova biblioteca" && git push');
console.log("O workflow do GitHub Actions vai buscar a contagem automaticamente no próximo agendamento (ou dispare manualmente pela aba Actions).");
