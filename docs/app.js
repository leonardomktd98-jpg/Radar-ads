// Dashboard estático: lê docs/data/libraries.json + docs/data/history.json
// (atualizados pelo workflow do GitHub Actions) e renderiza cards, deltas e
// gráficos. Não faz nenhuma chamada de rede além desses dois arquivos locais.

// >>> Depois de publicar no GitHub, troque pelo seu "usuario/repositorio" <<<
const REPO = "leonardomktd98-jpg/Radar-ads";

const DAY_MS = 24 * 60 * 60 * 1000;

let state = {
  libraries: [],
  history: {},
  search: "",
  sort: "name",
  activeLibId: null,
  activeRange: "30",
  chart: null,
};

init();

async function init() {
  bindGlobalUI();
  try {
    const [libraries, history] = await Promise.all([
      fetchJson("data/libraries.json"),
      fetchJson("data/history.json"),
    ]);
    state.libraries = libraries;
    state.history = history;
  } catch (err) {
    console.error("Falha ao carregar dados", err);
    state.libraries = [];
    state.history = {};
  }
  render();
}

function fetchJson(path) {
  return fetch(path, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`Não consegui carregar ${path}`);
    return r.json();
  });
}

/* ---------------- Cálculo de estatísticas ---------------- */

function dailySeries(entry) {
  // snapshots já vêm com no máximo 1 por dia (o scraper faz o upsert), só garante ordenação.
  return [...(entry?.snapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
}

function findOnOrBefore(series, isoDate) {
  let found = null;
  for (const snap of series) {
    if (snap.date <= isoDate) found = snap;
    else break;
  }
  return found;
}

function isoDateDaysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

function computeStats(lib) {
  const entry = state.history[lib.id];
  const series = dailySeries(entry);
  const latest = series[series.length - 1] || null;

  const refs = {
    day: findOnOrBefore(series.slice(0, -1), isoDateDaysAgo(1)),
    week: findOnOrBefore(series, isoDateDaysAgo(7)),
    month: findOnOrBefore(series, isoDateDaysAgo(30)),
  };

  const deltas = {};
  for (const key of ["day", "week", "month"]) {
    const ref = refs[key];
    if (!latest || !ref || ref.date === latest.date) {
      deltas[key] = null;
      continue;
    }
    deltas[key] = {
      abs: latest.count - ref.count,
      pct: ref.count === 0 ? null : ((latest.count - ref.count) / ref.count) * 100,
    };
  }

  return {
    lib,
    entry,
    series,
    latest,
    deltas,
    hasError: Boolean(entry?.lastError),
  };
}

/* ---------------- Render: lista de cards ---------------- */

function render() {
  const grid = document.getElementById("cardsGrid");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";

  if (state.libraries.length === 0) {
    empty.hidden = false;
    updateGlobalLastSync(null);
    return;
  }
  empty.hidden = true;

  let rows = state.libraries.map(computeStats);

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    rows = rows.filter((r) => r.lib.name.toLowerCase().includes(q));
  }

  rows = sortRows(rows, state.sort);

  const tpl = document.getElementById("cardTemplate");
  for (const row of rows) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    fillCard(node, row);
    node.addEventListener("click", () => openDetail(row.lib.id));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(row.lib.id);
      }
    });
    node.querySelector(".card__remove").addEventListener("click", (e) => {
      e.stopPropagation();
      removeLibrary(row.lib.id, row.lib.name);
    });
    grid.appendChild(node);
  }

  updateGlobalLastSync(rows);
}

function sortRows(rows, sort) {
  const withCount = (r) => r.latest?.count ?? -Infinity;
  const withDelta = (r, k) => r.deltas[k]?.abs ?? -Infinity;
  switch (sort) {
    case "count-desc":
      return rows.sort((a, b) => withCount(b) - withCount(a));
    case "delta-day-desc":
      return rows.sort((a, b) => withDelta(b, "day") - withDelta(a, "day"));
    case "delta-day-asc":
      return rows.sort((a, b) => withDelta(a, "day") - withDelta(b, "day"));
    case "delta-week-desc":
      return rows.sort((a, b) => withDelta(b, "week") - withDelta(a, "week"));
    default:
      return rows.sort((a, b) => a.lib.name.localeCompare(b.lib.name, "pt-BR"));
  }
}

function fillCard(node, row) {
  node.querySelector(".card__name").textContent = row.lib.name;
  node.querySelector(".card__name").title = row.lib.name;

  const errBadge = node.querySelector(".badge--error");
  errBadge.hidden = !row.hasError;

  const countEl = node.querySelector(".card__count");
  countEl.textContent = row.latest ? formatNumber(row.latest.count) : "—";

  const approxEl = node.querySelector(".card__approx");
  approxEl.hidden = !row.latest?.approx;

  for (const key of ["day", "week", "month"]) {
    const li = node.querySelector(`.delta[data-delta="${key}"]`);
    renderDelta(li, row.deltas[key]);
  }

  const svg = node.querySelector(".card__sparkline");
  renderSparkline(svg, row.series.slice(-30));

  const updated = node.querySelector(".card__updated");
  updated.textContent = row.latest ? `Atualizado em ${formatDate(row.latest.date)}` : "Sem dados ainda";
}

function renderDelta(li, delta) {
  const arrow = li.querySelector(".delta__arrow");
  const text = li.querySelector(".delta__text");
  li.classList.remove("is-up", "is-down", "is-flat", "is-na");

  if (!delta) {
    arrow.innerHTML = "";
    text.textContent = "sem dado ainda";
    li.classList.add("is-na");
    return;
  }

  const { abs, pct } = delta;
  const pctTxt = pct === null ? "" : ` (${abs >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
  text.textContent = `${abs > 0 ? "+" : ""}${formatNumber(abs)}${pctTxt}`;

  if (abs > 0) {
    li.classList.add("is-up");
    arrow.innerHTML = arrowSvg("up");
  } else if (abs < 0) {
    li.classList.add("is-down");
    arrow.innerHTML = arrowSvg("down");
  } else {
    li.classList.add("is-flat");
    arrow.innerHTML = arrowSvg("flat");
  }
}

function arrowSvg(dir) {
  if (dir === "up") return '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (dir === "down") return '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 6h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
}

function renderSparkline(svg, series) {
  svg.innerHTML = "";
  if (series.length < 2) return;
  const w = 240, h = 48, pad = 4;
  const counts = series.map((s) => s.count);
  const min = Math.min(...counts), max = Math.max(...counts);
  const span = max - min || 1;

  const points = series.map((s, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - ((s.count - min) / span) * (h - pad * 2);
    return [x, y];
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const ns = "http://www.w3.org/2000/svg";

  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", path);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--series-1)");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.appendChild(line);

  const last = points[points.length - 1];
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", last[0]);
  dot.setAttribute("cy", last[1]);
  dot.setAttribute("r", "2.6");
  dot.setAttribute("fill", "var(--series-1)");
  svg.appendChild(dot);
}

function updateGlobalLastSync(rows) {
  const el = document.getElementById("lastSync");
  const timestamps = (rows || [])
    .map((r) => r.entry?.snapshots?.[r.entry.snapshots.length - 1]?.timestamp)
    .filter(Boolean)
    .sort();
  const last = timestamps[timestamps.length - 1];
  el.textContent = last ? `Última atualização: ${formatDateTime(last)}` : "Ainda sem coletas registradas";
}

/* ---------------- Painel de detalhe ---------------- */

function openDetail(libId) {
  state.activeLibId = libId;
  const panel = document.getElementById("detailPanel");
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  document.getElementById("detailTable").hidden = true;
  document.getElementById("detailChart").style.display = "";
  document.getElementById("tableToggle").textContent = "Ver como tabela";
  renderDetail();
}

function closeDetail() {
  const panel = document.getElementById("detailPanel");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  state.activeLibId = null;
}

function renderDetail() {
  const row = computeStats(state.libraries.find((l) => l.id === state.activeLibId));
  document.getElementById("detailTitle").textContent = row.lib.name;
  const link = document.getElementById("detailLink");
  link.href = row.lib.url;

  const statsWrap = document.getElementById("detailStats");
  statsWrap.innerHTML = "";
  statsWrap.appendChild(statTile("Atual", row.latest ? formatNumber(row.latest.count) : "—"));
  statsWrap.appendChild(statTile("Vs. ontem", deltaLabel(row.deltas.day)));
  statsWrap.appendChild(statTile("Vs. 7 dias", deltaLabel(row.deltas.week)));

  renderDetailChartOrTable(row);
}

function deltaLabel(delta) {
  if (!delta) return "—";
  const { abs, pct } = delta;
  const pctTxt = pct === null ? "" : ` (${pct.toFixed(1)}%)`;
  return `${abs > 0 ? "+" : ""}${formatNumber(abs)}${pctTxt}`;
}

function statTile(label, value) {
  const div = document.createElement("div");
  div.className = "stat-tile";
  div.innerHTML = `<div class="stat-tile__label">${label}</div><div class="stat-tile__value">${value}</div>`;
  return div;
}

function seriesForRange(series, range) {
  if (range === "all") return series;
  const days = parseInt(range, 10);
  const cutoff = isoDateDaysAgo(days);
  return series.filter((s) => s.date >= cutoff);
}

function renderDetailChartOrTable(row) {
  const series = seriesForRange(row.series, state.activeRange);
  const isTable = !document.getElementById("detailTable").hidden;

  if (isTable) {
    renderTable(series);
    return;
  }

  const canvas = document.getElementById("detailChart");
  const styles = getComputedStyle(document.querySelector(".viz-root"));
  const seriesColor = styles.getPropertyValue("--series-1").trim();
  const gridColor = styles.getPropertyValue("--gridline").trim();
  const textColor = styles.getPropertyValue("--text-secondary").trim();

  const labels = series.map((s) => formatDate(s.date));
  const data = series.map((s) => s.count);

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  if (typeof Chart === "undefined" || series.length === 0) {
    return;
  }

  state.chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: row.lib.name,
          data,
          borderColor: seriesColor,
          backgroundColor: hexToRgba(seriesColor, 0.12),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: seriesColor,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${formatNumber(ctx.parsed.y)} anúncios`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, maxTicksLimit: 8, font: { size: 11 } },
        },
        y: {
          beginAtZero: false,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 11 }, precision: 0 },
        },
      },
    },
  });
}

function renderTable(series) {
  const wrap = document.getElementById("detailTable");
  const rowsHtml = [...series]
    .reverse()
    .map((s, i, arr) => {
      const prev = arr[i + 1];
      const delta = prev ? s.count - prev.count : null;
      const deltaTxt = delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
      return `<tr><td>${formatDate(s.date)}</td><td>${formatNumber(s.count)}${s.approx ? " ~" : ""}</td><td>${deltaTxt}</td></tr>`;
    })
    .join("");
  wrap.innerHTML = `<table>
    <thead><tr><th>Data</th><th>Anúncios</th><th>Variação</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="3">Sem dados no período.</td></tr>'}</tbody>
  </table>`;
}

/* ---------------- UI global ---------------- */

function bindGlobalUI() {
  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });
  document.getElementById("sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  document.getElementById("detailScrim").addEventListener("click", closeDetail);
  document.getElementById("detailClose").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("detailPanel").hidden) closeDetail();
  });

  document.querySelectorAll(".range-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-tab").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.activeRange = btn.dataset.range;
      renderDetail();
    });
  });

  document.getElementById("tableToggle").addEventListener("click", () => {
    const table = document.getElementById("detailTable");
    const canvas = document.getElementById("detailChart");
    const showingTable = table.hidden;
    table.hidden = !showingTable;
    canvas.style.display = showingTable ? "none" : "";
    document.getElementById("tableToggle").textContent = showingTable ? "Ver gráfico" : "Ver como tabela";
    renderDetail();
  });

  document.getElementById("updateLink").href =
    REPO === "SEU-USUARIO/SEU-REPOSITORIO"
      ? "#"
      : `https://github.com/${REPO}/actions/workflows/update.yml`;
  document.getElementById("updateLink").addEventListener("click", (e) => {
    if (REPO === "SEU-USUARIO/SEU-REPOSITORIO") {
      e.preventDefault();
      alert('Configure a constante REPO em docs/app.js com "usuario/repositorio" para habilitar este atalho.');
    }
  });

  document.getElementById("addBtn").addEventListener("click", openAddModal);
  document.getElementById("addModalScrim").addEventListener("click", closeAddModal);
  document.getElementById("addModalClose").addEventListener("click", closeAddModal);
  document.getElementById("tokenSave").addEventListener("click", saveTokenStep);
  document.getElementById("changeTokenLink").addEventListener("click", () => showAddStep("token"));
  document.getElementById("addForm").addEventListener("submit", submitAddForm);
  document.getElementById("addAnother").addEventListener("click", () => showAddStep("form"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("addModal").hidden) closeAddModal();
  });

  initTheme();
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
}

function initTheme() {
  const saved = localStorage.getItem("ads-tracker-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const currentlyDark = current ? current === "dark" : prefersDark;
  const next = currentlyDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("ads-tracker-theme", next);
  if (state.activeLibId) renderDetail();
}

/* ---------------- Salvar direto no GitHub (sem terminal, sem git) ---------------- */
// O dashboard escreve em docs/data/libraries.json via GitHub Contents API,
// usando um token pessoal que o usuário cola uma vez e fica só no localStorage
// deste navegador. Isso já dispara o workflow (ele roda em todo push nesse
// arquivo), então a contagem chega sozinha em ~1 minuto.

const TOKEN_KEY = "ads-tracker-gh-token";
const LIB_PATH = "docs/data/libraries.json";
const HIST_PATH = "docs/data/history.json";

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghErrorMessage(res) {
  if (res.status === 401) return "Token inválido ou expirado. Clique em “Trocar token” e gere um novo.";
  if (res.status === 403) return "Sem permissão de escrita. Confira se o token tem “Contents: Read and write” neste repositório.";
  if (res.status === 404) return "Repositório ou arquivo não encontrado. Confira a constante REPO em docs/app.js e se o token tem acesso a este repositório.";
  try {
    const body = await res.json();
    if (body.message) return `Erro do GitHub: ${body.message}`;
  } catch {
    /* resposta sem corpo JSON */
  }
  return `Erro inesperado do GitHub (${res.status}).`;
}

async function ghGetFile(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${getToken()}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await ghErrorMessage(res));
  const json = await res.json();
  return { sha: json.sha, data: JSON.parse(base64ToUtf8(json.content)) };
}

async function ghPutFile(path, dataObj, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(JSON.stringify(dataObj, null, 2) + "\n"),
      sha,
      branch: "main",
    }),
  });
  if (!res.ok) throw new Error(await ghErrorMessage(res));
  return res.json();
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
    return new URL(rawUrl).searchParams.get("view_all_page_id");
  } catch {
    return null;
  }
}

function uniqueSlug(name, libraries) {
  const base = slugify(name) || "anunciante";
  const existing = new Set(libraries.map((l) => l.id));
  let id = base;
  let suffix = 1;
  while (existing.has(id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }
  return id;
}

/* ---------------- Modal: Adicionar anunciante ---------------- */

function openAddModal() {
  const modal = document.getElementById("addModal");
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("tokenRepoName").textContent = REPO;
  if (getToken()) {
    showAddStep("form");
  } else {
    showAddStep("token");
  }
}

function closeAddModal() {
  const modal = document.getElementById("addModal");
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
}

function showAddStep(step) {
  document.getElementById("tokenStep").hidden = step !== "token";
  document.getElementById("addForm").hidden = step !== "form";
  document.getElementById("addSuccess").hidden = step !== "success";
  document.getElementById("tokenError").hidden = true;
  document.getElementById("addError").hidden = true;
  if (step === "token") document.getElementById("tokenInput").focus();
  if (step === "form") document.getElementById("addName").focus();
}

function saveTokenStep() {
  const input = document.getElementById("tokenInput");
  const value = input.value.trim();
  const errEl = document.getElementById("tokenError");
  if (!value) {
    errEl.textContent = "Cole o token gerado no GitHub antes de continuar.";
    errEl.hidden = false;
    return;
  }
  setToken(value);
  input.value = "";
  showAddStep("form");
}

async function submitAddForm(e) {
  e.preventDefault();
  const name = document.getElementById("addName").value.trim();
  const url = document.getElementById("addUrl").value.trim();
  const errEl = document.getElementById("addError");
  const submitBtn = document.getElementById("addSubmit");
  errEl.hidden = true;
  if (!name || !url) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando…";
  try {
    const { sha, data: libraries } = await ghGetFile(LIB_PATH);
    const id = uniqueSlug(name, libraries);
    const pageId = extractPageId(url);
    libraries.push({ id, name, url, pageId });
    await ghPutFile(LIB_PATH, libraries, sha, `add: ${name}`);

    state.libraries = libraries;
    document.getElementById("addForm").reset();
    showAddStep("success");
    render();
  } catch (err) {
    if (String(err.message).includes("Token inválido")) {
      showAddStep("token");
      document.getElementById("tokenError").textContent = err.message;
      document.getElementById("tokenError").hidden = false;
    } else {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Adicionar";
  }
}

async function removeLibrary(id, name) {
  if (!confirm(`Remover "${name}" do rastreamento? O histórico já coletado também será apagado.`)) return;
  if (!getToken()) {
    openAddModal();
    return;
  }
  try {
    const { sha: libSha, data: libraries } = await ghGetFile(LIB_PATH);
    const nextLibraries = libraries.filter((l) => l.id !== id);
    await ghPutFile(LIB_PATH, nextLibraries, libSha, `remove: ${name}`);
    state.libraries = nextLibraries;

    const { sha: histSha, data: history } = await ghGetFile(HIST_PATH);
    if (history[id]) {
      delete history[id];
      await ghPutFile(HIST_PATH, history, histSha, `chore: limpar histórico de ${name}`);
      state.history = history;
    }
    render();
  } catch (err) {
    alert(`Não consegui remover: ${err.message}`);
  }
}

/* ---------------- Formatação ---------------- */

function formatNumber(n) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
