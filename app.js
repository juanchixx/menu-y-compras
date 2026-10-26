import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
// caché local: la app abre y anda sin señal (en el súper), y sincroniza al volver
const fs = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// personas que cocinan: lista compartida; las comidas guardan el id, así renombrar no toca las comidas
const COLORES = {
  lila: { p: "#7828c8", bg: "#f4ecfc", line: "#dcc4f5" },
  agua: { p: "#0a7b83", bg: "#e6f7f7", line: "#b4e3e5" },
  durazno: { p: "#c4560c", bg: "#fdf0e6", line: "#f7cfae" },
  rosa: { p: "#c20e4d", bg: "#fdeef3", line: "#f6c3d5" },
  cielo: { p: "#005bc4", bg: "#eaf3fe", line: "#bcd8fb" },
  oliva: { p: "#5a7a12", bg: "#f1f6e4", line: "#d3e2ad" }
};
const PERSONAS_INICIALES = [{ id: "Go", nombre: "Gera", color: "lila" }, { id: "Jx", nombre: "Jx", color: "agua" }];
// dónde se compra: lista compartida, igual que las personas; los ingredientes guardan el id.
// "super" no se puede quitar: ahí caen los ingredientes de un tipo borrado y las cosas sueltas de antes
const COLORES_TIPO = {
  gris: { p: "#3f3f46", bg: "#e4e4e7", line: "#d4d4d8" },
  verde: { p: "#0e793c", bg: "#d1f4e0", line: "#a7e5c2" },
  rojo: { p: "#c20e4d", bg: "#fdd0df", line: "#f8aec6" },
  naranja: { p: "#b45309", bg: "#fde8cc", line: "#f8d19c" },
  azul: { p: "#005bc4", bg: "#dbeafe", line: "#b5d3fb" },
  violeta: { p: "#7828c8", bg: "#ecdcfb", line: "#d6b9f5" },
  agua: { p: "#0a7b83", bg: "#d2f1f2", line: "#a6e0e3" },
  marron: { p: "#7c4a1e", bg: "#f1e2d3", line: "#e0c6ab" }
};
const ICONOS_TIPO = ["🛒", "🥬", "🥩", "🥖", "🧀", "🐟", "💊", "🧴", "🍷", "🐾", "🌰", "🛍️"];
const TIPOS_INICIALES = [
  { id: "super", nombre: "Súper", color: "gris", icono: "🛒" },
  { id: "verdu", nombre: "Verdulería", color: "verde", icono: "🥬" },
  { id: "carni", nombre: "Carnicería", color: "rojo", icono: "🥩" }
];
// al agregar uno nuevo se sugiere un ícono por el nombre; después se cambia
const ICONO_POR_NOMBRE = [[/panad|pan\b|factura/i, "🥖"], [/fiambr|queso|lacteo|lácteo/i, "🧀"], [/pesca|pescad/i, "🐟"], [/farmac|remedio/i, "💊"], [/limpi|perfum/i, "🧴"], [/vino|bebid|licor/i, "🍷"], [/mascot|veterin|perro|gato/i, "🐾"], [/dietet|dietét|granel|semilla/i, "🌰"], [/verdu|frut/i, "🥬"], [/carni|pollo/i, "🥩"]];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const state = { personas: PERSONAS_INICIALES.map(p => ({ ...p })), tipos: TIPOS_INICIALES.map(t => ({ ...t })), menu: false, quitar: null, comidas: {}, extras: {}, tab: "semana", weekStart: monday(new Date()) };
try { if (localStorage.getItem("tab") === "compras") state.tab = "compras"; } catch (e) {}

// color de acento, elegido por cada uno en su dispositivo
const ACENTOS = [["Azul", "#006fee"], ["Violeta", "#7828c8"], ["Verde", "#12a150"], ["Rosa", "#e4006f"], ["Naranja", "#e07a00"], ["Grafito", "#3f3f46"]];
function aplicarAcento(hex) { state.acento = hex; document.documentElement.style.setProperty("--accent", hex); }
let guardado = null;
try { guardado = localStorage.getItem("acento"); } catch (e) {}
aplicarAcento(ACENTOS.some(a => a[1] === guardado) ? guardado : ACENTOS[0][1]);

// ---------- fechas ----------
function monday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parse(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function key(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function weekDays() { return Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i)); }
function shortDate(d) { return d.getDate() + " " + MESES[d.getMonth()]; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------- almacenamiento ----------
// Firestore aplica cada escritura al instante en la caché local y la sube cuando hay conexión.
const chains = {};
function serial(k, fn) { chains[k] = (chains[k] || Promise.resolve()).then(fn).catch(err => { console.error(err); showError(err); }); return chains[k]; }
const limpio = o => JSON.parse(JSON.stringify(o));
function persona(id) { return id ? state.personas.find(p => p.id === id) : null; }
function pvars(p) { const c = COLORES[p.color] || COLORES.lila; return "--p:" + c.p + ";--p-bg:" + c.bg + ";--p-line:" + c.line; }
function savePersonas() {
  render();
  const body = { lista: limpio(state.personas) };
  serial("personas", () => setDoc(doc(fs, "config", "personas"), body));
}
// un tipo que ya no está (o un ingrediente viejo sin tipo) se muestra como Súper
function tipoDe(id) { return state.tipos.some(t => t.id === id) ? id : "super"; }
function tipo(id) { return state.tipos.find(t => t.id === tipoDe(id)) || TIPOS_INICIALES[0]; }
function tvars(t) { const c = COLORES_TIPO[t.color] || COLORES_TIPO.gris; return "--t:" + c.p + ";--t-bg:" + c.bg + ";--t-line:" + c.line; }
function saveTipos() {
  render();
  const body = { lista: limpio(state.tipos) };
  serial("tipos", () => setDoc(doc(fs, "config", "tipos"), body));
}
// lo que está cargado en un tipo: ingredientes de todas las comidas y cosas sueltas
function usosTipo(id) {
  const ings = Object.keys(state.comidas).reduce((n, k) => n + (state.comidas[k].ingredientes || []).filter(i => i.tipo === id).length, 0);
  const extras = Object.values(state.extras).filter(e => e.tipo === id).length;
  return { ings, extras };
}
function comidasDe(id) { return Object.keys(state.comidas).filter(k => state.comidas[k].cocina === id); }

function saveComida(k) {
  const c = state.comidas[k];
  const vacia = !c || (!c.cocina && !c.plato && !(c.ingredientes || []).length && !c.notas);
  if (vacia) delete state.comidas[k];
  render();
  const ref = doc(fs, "comidas", k);
  const body = vacia ? null : limpio(c);
  serial("c" + k, () => body ? setDoc(ref, body) : deleteDoc(ref));
}
function saveExtra(id) {
  const e = state.extras[id];
  render();
  const ref = doc(fs, "extras", id);
  const body = e ? limpio(e) : null;
  serial("e" + id, () => body ? setDoc(ref, body) : deleteDoc(ref));
}
function showError(err) {
  const code = err && err.code;
  const msg = code === "permission-denied" ? "No se pudo guardar: esta cuenta no tiene permiso para editar."
    : code === "resource-exhausted" ? "No se pudo guardar: se llegó al límite gratuito de hoy. Mañana vuelve a andar."
    : "No se pudo guardar el último cambio. Revisá la conexión y probá de nuevo.";
  state.error = msg; render();
}

// ---------- respaldo ----------
function exportar() {
  const data = { version: 1, exportado: new Date().toISOString(), personas: state.personas, tipos: state.tipos, comidas: state.comidas, extras: state.extras };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "menu-y-compras-" + key(new Date()) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importar(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== "object" || (!data.comidas && !data.personas)) throw new Error("formato");
    const writes = [];
    if (Array.isArray(data.personas) && data.personas.length) writes.push([doc(fs, "config", "personas"), { lista: data.personas }]);
    if (Array.isArray(data.tipos) && data.tipos.some(t => t.id === "super")) writes.push([doc(fs, "config", "tipos"), { lista: data.tipos }]);
    Object.entries(data.comidas || {}).forEach(([k, c]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(k)) writes.push([doc(fs, "comidas", k), c]); });
    Object.entries(data.extras || {}).forEach(([id, e]) => writes.push([doc(fs, "extras", id), e]));
    // de a 400 para no pasar el límite de 500 escrituras por lote
    for (let i = 0; i < writes.length; i += 400) {
      const b = writeBatch(fs);
      writes.slice(i, i + 400).forEach(([ref, body]) => b.set(ref, limpio(body)));
      await b.commit();
    }
    state.aviso = "Listo: se importaron " + Object.keys(data.comidas || {}).length + " días y " + Object.keys(data.extras || {}).length + " cosas de la lista.";
  } catch (err) {
    console.error(err);
    state.aviso = err && err.code ? "No se pudo importar: " + err.code : "Ese archivo no parece un respaldo de Menú y Compras.";
  }
  render();
}

// ---------- correr un día ----------
// Se corre el día elegido y los días con plan que le siguen sin hueco; el primer día libre absorbe el corrimiento.
function bloque(k) { const ks = []; let d = parse(k); while (state.comidas[key(d)]) { ks.push(key(d)); d = addDays(d, 1); } return ks; }
function correr(k) {
  const ks = bloque(k); if (!ks.length) return;
  const afectados = [...ks, key(addDays(parse(ks[ks.length - 1]), 1))];
  const prev = {};
  afectados.forEach(x => { prev[x] = state.comidas[x] ? limpio(state.comidas[x]) : null; });
  for (let i = ks.length - 1; i >= 0; i--) state.comidas[afectados[i + 1]] = state.comidas[ks[i]];
  delete state.comidas[k];
  state.confirmar = null;
  state.deshacer = { prev, texto: (ks.length === 1 ? "Se corrió 1 comida" : "Se corrieron " + ks.length + " comidas") + " un día." };
  flipped.clear();
  afectados.forEach(saveComida);
}
function deshacer() {
  const u = state.deshacer; if (!u) return;
  state.deshacer = null;
  Object.keys(u.prev).forEach(x => { if (u.prev[x]) state.comidas[x] = u.prev[x]; else delete state.comidas[x]; saveComida(x); });
}

function comida(k) { return state.comidas[k] || (state.comidas[k] = { cocina: "", plato: "", ingredientes: [] }); }

// ---------- render ----------
const view = document.getElementById("view");
const sheetEl = document.getElementById("sheet");

function render() {
  if (!auth.currentUser) return;
  // conservar foco y lo que se está escribiendo
  const a = document.activeElement;
  const keep = a && a.id && (view.contains(a) || sheetEl.contains(a)) ? { id: a.id, value: a.value, s: a.selectionStart, e: a.selectionEnd, text: a.type === "text" || a.tagName === "TEXTAREA" } : null;

  const days = weekDays();
  document.getElementById("weekTitle").innerHTML =
    (state.tab === "semana" ? "Menú de la semana<small>" + shortDate(days[0]) + " al " + shortDate(days[6]) + " " + days[6].getFullYear()
      : "Compras<small>del " + shortDate(days[0]) + " " + days[0].getFullYear() + " en adelante") + "</small>";
  document.getElementById("tab-semana").setAttribute("aria-selected", state.tab === "semana");
  document.getElementById("tab-compras").setAttribute("aria-selected", state.tab === "compras");
  const pend = pendientes();
  document.getElementById("tab-compras").innerHTML = "Compras" + (pend ? '<span class="count">' + pend + "</span>" : "");

  view.innerHTML = "";
  if (state.error) {
    const n = el("p", { class: "notice", role: "alert" }, state.error + " ");
    n.appendChild(el("button", { class: "linkbtn", onclick: () => { state.error = null; render(); } }, "Cerrar"));
    view.appendChild(n);
  }
  if (state.deshacer) {
    const n = el("p", { class: "notice", role: "status" }, state.deshacer.texto + " ");
    n.appendChild(el("button", { class: "linkbtn", onclick: deshacer }, "Deshacer"));
    n.appendChild(el("button", { class: "linkbtn", onclick: () => { state.deshacer = null; render(); } }, "Cerrar"));
    view.appendChild(n);
  }
  view.appendChild(renderHoy());
  view.appendChild(state.tab === "semana" ? renderSemana(days) : renderCompras());
  const colors = el("div", { class: "colors", role: "group", "aria-label": "Color de la app" }, "Color de la app:");
  ACENTOS.forEach(([nombre, hex]) => colors.appendChild(el("button", {
    class: "swatch", style: "background:" + hex, title: nombre, "aria-label": nombre, "aria-pressed": String(state.acento === hex),
    onclick: () => { aplicarAcento(hex); try { localStorage.setItem("acento", hex); } catch (e) {} render(); }
  })));
  view.appendChild(colors);
  renderMenu();

  if (keep) {
    const n = document.getElementById(keep.id);
    if (n) {
      if (keep.text) { n.value = keep.value; }
      n.focus({ preventScroll: true });
      if (keep.text) try { n.setSelectionRange(keep.s, keep.e); } catch (e) {}
    }
  }
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}

function renderHoy() {
  const d = new Date(), c = state.comidas[key(d)] || {};
  const per = persona(c.cocina), quien = per && per.nombre, plato = c.plato;
  let big;
  if (quien && plato) big = "Cocina " + quien + ": " + plato;
  else if (quien) big = "Cocina " + quien + ", todavía sin plato";
  else if (plato) big = plato;
  else big = "Nada planeado para hoy";
  return el("section", { class: "hoycard" + (per ? " has-cook" : ""), style: per ? pvars(per) : null, "aria-label": "Hoy" },
    el("div", { class: "avatar" + (quien && quien.length > 3 ? " long" : ""), "aria-hidden": "true" }, quien ? quien.slice(0, 6) : "—"),
    el("div", {}, el("div", { class: "lbl" }, "Hoy · " + DIAS[d.getDay()] + " " + shortDate(d)), el("div", { class: "big" }, big)));
}

const ICON_NOTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
const ICON_VOLVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
// clima de Córdoba (Open-Meteo, sin clave): un pedido por carga; los últimos 3 meses y los próximos 16 días
const CLIMA_URL = "https://api.open-meteo.com/v1/forecast?latitude=-31.4201&longitude=-64.1888&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=America%2FArgentina%2FCordoba&past_days=92&forecast_days=16";
let clima = null;
function cargarClima() {
  if (clima) return;
  clima = {};
  fetch(CLIMA_URL).then(r => r.ok ? r.json() : null).then(j => {
    const dd = j && j.daily; if (!dd || !dd.time) return;
    dd.time.forEach((k, i) => {
      const max = dd.temperature_2m_max[i], min = dd.temperature_2m_min[i];
      if (max != null && min != null) clima[k] = { max: Math.round(max), min: Math.round(min), code: dd.weather_code ? dd.weather_code[i] : null };
    });
    render();
  }).catch(() => {});
}
function iconoClima(c) {
  if (c == null) return "";
  if (c === 0) return "☀️";
  if (c <= 2) return "🌤️";
  if (c === 3) return "☁️";
  if (c <= 48) return "🌫️";
  if (c >= 95) return "⛈️";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "❄️";
  return "🌧️";
}
function climaDia(k) {
  const w = clima && clima[k];
  if (!w) return null;
  return el("span", { class: "clima", title: "Clima en Córdoba: máxima " + w.max + " °C, mínima " + w.min + " °C" },
    iconoClima(w.code) + " ", el("b", {}, w.max + "°"), " / " + w.min + "°");
}
const flipped = new Set();
function iconBtn(svg, label, onclick, dot) {
  const b = el("button", { class: "iconsm", "aria-label": label, title: label, onclick });
  b.innerHTML = svg + (dot ? '<span class="dot"></span>' : "");
  return b;
}
// se da vuelta sin re-dibujar, así se ve la animación
function voltear(k, section) {
  const on = !flipped.has(k);
  if (on) flipped.add(k); else flipped.delete(k);
  section.classList.toggle("flipped", on);
  section.querySelector(".front").inert = on;
  section.querySelector(".back").inert = !on;
  const t = on ? document.getElementById("notas-" + k) : section.querySelector(".front .iconsm");
  if (t) setTimeout(() => t.focus({ preventScroll: true }), on ? 300 : 0);
}

function renderMenu() {
  sheetEl.innerHTML = "";
  if (!state.menu) { if (state.detalle) renderDetalle(); return; }
  if (state.menu === "tipos") return renderTipos();
  const cerrar = () => { state.menu = false; state.quitar = null; state.aviso = null; render(); document.getElementById("menuPersonas").focus(); };
  sheetEl.appendChild(el("div", { class: "scrim", onclick: cerrar }));
  const box = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Quién cocina" });
  box.appendChild(el("div", { class: "sheet-head" }, el("h2", {}, "Quién cocina"), el("button", { class: "x", "aria-label": "Cerrar", onclick: cerrar }, "×")));
  state.personas.forEach(p => {
    const row = el("div", { class: "prow", style: pvars(p) });
    const nombre = el("input", {
      id: "pn-" + p.id, type: "text", "aria-label": "Nombre", maxlength: "20",
      onchange: e => { const v = e.target.value.trim(); if (v && v !== p.nombre) { p.nombre = v; savePersonas(); } else e.target.value = p.nombre; }
    });
    nombre.value = p.nombre;
    row.appendChild(el("div", { class: "prow-top" }, nombre,
      el("button", { class: "x", "aria-label": "Quitar a " + p.nombre, title: "Quitar", onclick: () => {
        if (comidasDe(p.id).length) { state.quitar = p.id; render(); } else quitarPersona(p.id);
      } }, "×")));
    const cols = el("div", { class: "pcolors", role: "group", "aria-label": "Color de " + p.nombre });
    Object.keys(COLORES).forEach(nc => cols.appendChild(el("button", {
      style: "background:" + COLORES[nc].p, "aria-label": nc, title: nc, "aria-pressed": String(p.color === nc),
      onclick: () => { p.color = nc; savePersonas(); }
    })));
    row.appendChild(cols);
    if (state.quitar === p.id) {
      const n = comidasDe(p.id).length;
      row.appendChild(el("div", { class: "warn" },
        el("span", {}, p.nombre + " tiene " + (n === 1 ? "1 comida asignada" : n + " comidas asignadas") + ". Si lo quitás, esas comidas quedan sin cocinero."),
        el("div", { class: "btns" },
          el("button", { class: "btn ghost", onclick: () => { state.quitar = null; render(); } }, "Cancelar"),
          el("button", { class: "btn danger", onclick: () => quitarPersona(p.id) }, "Quitar igual"))));
    }
    box.appendChild(row);
  });
  const input = el("input", { id: "nueva-persona", type: "text", placeholder: "Agregar persona", "aria-label": "Nueva persona", maxlength: "20" });
  const add = () => {
    const v = input.value.trim(); if (!v) return;
    input.value = "";
    const usados = state.personas.map(p => p.color);
    const color = Object.keys(COLORES).find(c => !usados.includes(c)) || "lila";
    state.personas.push({ id: uid(), nombre: v, color });
    savePersonas();
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  box.appendChild(el("div", { class: "addrow" }, input, el("button", { onclick: add, "aria-label": "Agregar" }, "+")));
  box.appendChild(el("p", { class: "hint" }, "Los cambios se ven para todos. Cambiar un nombre actualiza todas sus comidas."));

  // respaldo y cuenta
  box.appendChild(el("p", { class: "sheet-sub" }, "Respaldo"));
  const file = el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: e => { const f = e.target.files[0]; if (f) importar(f); } });
  box.appendChild(el("div", { class: "sheet-tools" },
    el("button", { class: "btn ghost", onclick: exportar }, "Descargar copia"),
    el("button", { class: "btn ghost", onclick: () => file.click() }, "Importar copia"), file));
  if (state.aviso) box.appendChild(el("p", { class: "hint", role: "status" }, state.aviso));
  box.appendChild(el("div", { class: "sheet-tools" },
    el("span", { class: "hint", style: "flex:1;overflow-wrap:anywhere" }, "Entraste como " + (auth.currentUser.email || "")),
    el("button", { class: "linkbtn", onclick: () => { state.menu = false; signOut(auth); } }, "Salir")));
  box.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
  sheetEl.appendChild(box);
}
function quitarPersona(id) {
  comidasDe(id).forEach(k => { state.comidas[k].cocina = ""; saveComida(k); });
  state.personas = state.personas.filter(p => p.id !== id);
  state.quitar = null;
  savePersonas();
}

function renderTipos() {
  const cerrar = () => { state.menu = false; state.quitar = null; render(); document.getElementById("menuTipos").focus(); };
  sheetEl.appendChild(el("div", { class: "scrim", onclick: cerrar }));
  const box = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Dónde se compra" });
  box.appendChild(el("div", { class: "sheet-head" }, el("h2", {}, "Dónde se compra"), el("button", { class: "x", "aria-label": "Cerrar", onclick: cerrar }, "×")));
  const mover = (i, d) => { const l = state.tipos; [l[i], l[i + d]] = [l[i + d], l[i]]; saveTipos(); };
  state.tipos.forEach((t, i) => {
    const c = COLORES_TIPO[t.color] || COLORES_TIPO.gris;
    const row = el("div", { class: "prow", style: "--p-bg:" + c.bg + ";--p-line:" + c.line });
    const nombre = el("input", {
      id: "tn-" + t.id, type: "text", "aria-label": "Nombre", maxlength: "20",
      onchange: e => { const v = e.target.value.trim(); if (v && v !== t.nombre) { t.nombre = v; saveTipos(); } else e.target.value = t.nombre; }
    });
    nombre.value = t.nombre;
    row.appendChild(el("div", { class: "prow-top" },
      el("span", { class: "tico", "aria-hidden": "true" }, t.icono || ""), nombre,
      el("button", { class: "mv", "aria-label": "Subir " + t.nombre, title: "Subir", disabled: i === 0, onclick: () => mover(i, -1) }, "↑"),
      el("button", { class: "mv", "aria-label": "Bajar " + t.nombre, title: "Bajar", disabled: i === state.tipos.length - 1, onclick: () => mover(i, 1) }, "↓"),
      t.id === "super" ? null : el("button", { class: "x", "aria-label": "Quitar " + t.nombre, title: "Quitar", onclick: () => {
        const u = usosTipo(t.id);
        if (u.ings || u.extras) { state.quitar = t.id; render(); } else quitarTipo(t.id);
      } }, "×")));
    const cols = el("div", { class: "pcolors", role: "group", "aria-label": "Color de " + t.nombre });
    Object.keys(COLORES_TIPO).forEach(nc => cols.appendChild(el("button", {
      style: "background:" + COLORES_TIPO[nc].p, "aria-label": nc, title: nc, "aria-pressed": String(t.color === nc),
      onclick: () => { t.color = nc; saveTipos(); }
    })));
    row.appendChild(cols);
    const icos = el("div", { class: "picons", role: "group", "aria-label": "Ícono de " + t.nombre });
    ICONOS_TIPO.forEach(ic => icos.appendChild(el("button", {
      "aria-label": ic, "aria-pressed": String(t.icono === ic),
      onclick: () => { t.icono = t.icono === ic ? "" : ic; saveTipos(); }
    }, ic)));
    row.appendChild(icos);
    if (state.quitar === t.id) {
      const u = usosTipo(t.id), partes = [];
      if (u.ings) partes.push(u.ings === 1 ? "1 ingrediente" : u.ings + " ingredientes");
      if (u.extras) partes.push(u.extras === 1 ? "1 cosa suelta" : u.extras + " cosas sueltas");
      const sup = tipo("super").nombre;
      row.appendChild(el("div", { class: "warn" },
        el("span", {}, t.nombre + " tiene " + partes.join(" y ") + ". Si lo quitás, pasan a " + sup + "."),
        el("div", { class: "btns" },
          el("button", { class: "btn ghost", onclick: () => { state.quitar = null; render(); } }, "Cancelar"),
          el("button", { class: "btn danger", onclick: () => quitarTipo(t.id) }, "Pasar a " + sup + " y quitar"))));
    }
    box.appendChild(row);
  });
  const input = el("input", { id: "nuevo-tipo", type: "text", placeholder: "Agregar (ej: Panadería, Farmacia)", "aria-label": "Nuevo lugar de compra", maxlength: "20" });
  const add = () => {
    const v = input.value.trim(); if (!v) return;
    input.value = "";
    const usados = state.tipos.map(t => t.color);
    const color = Object.keys(COLORES_TIPO).find(c => !usados.includes(c)) || "gris";
    const sug = ICONO_POR_NOMBRE.find(([re]) => re.test(v));
    state.tipos.push({ id: uid(), nombre: v, color, icono: sug ? sug[1] : "🛍️" });
    saveTipos();
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  box.appendChild(el("div", { class: "addrow" }, input, el("button", { onclick: add, "aria-label": "Agregar" }, "+")));
  box.appendChild(el("p", { class: "hint" }, "Los cambios se ven para todos. El orden es el de la pantalla Compras. " + tipo("super").nombre + " no se puede quitar: es donde van las cosas de un lugar que se borra."));
  box.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
  sheetEl.appendChild(box);
}
// lo cargado en ese lugar pasa al súper, en todas las comidas (también las pasadas)
function quitarTipo(id) {
  if (id === "super") return;
  Object.keys(state.comidas).forEach(k => {
    const ings = state.comidas[k].ingredientes || [];
    if (ings.some(i => i.tipo === id)) { ings.forEach(i => { if (i.tipo === id) i.tipo = "super"; }); saveComida(k); }
  });
  Object.keys(state.extras).forEach(eid => { if (state.extras[eid].tipo === id) { state.extras[eid].tipo = "super"; saveExtra(eid); } });
  state.tipos = state.tipos.filter(t => t.id !== id);
  state.quitar = null;
  saveTipos();
}

function renderSemana(days) {
  cargarClima();
  const grid = el("div", { class: "days" });
  const hoy = key(new Date());
  days.forEach(d => {
    const k = key(d);
    const c = state.comidas[k] || { cocina: "", plato: "", ingredientes: [] };
    const section = el("section", { class: "day" + (k === hoy ? " is-today" : "") + (persona(c.cocina) ? " has-cook" : "") + (flipped.has(k) ? " flipped" : ""), style: persona(c.cocina) ? pvars(persona(c.cocina)) : null, "aria-label": DIAS[d.getDay()] + " " + shortDate(d) });
    const card = el("div", { class: "face front" });

    const cook = el("div", { class: "cook", role: "group", "aria-label": "Quién cocina" });
    const actual = persona(c.cocina) ? c.cocina : "";
    [...state.personas, null].forEach(p => {
      const id = p ? p.id : "";
      cook.appendChild(el("button", {
        class: p ? "is-p" : null, style: p ? pvars(p) : null, "aria-pressed": String(actual === id),
        title: p ? "Cocina " + p.nombre : "Nadie cocina",
        onclick: () => { comida(k).cocina = id; saveComida(k); }
      }, p ? p.nombre : "—"));
    });
    card.appendChild(el("div", { class: "day-head" },
      el("div", { class: "day-name" }, DIAS[d.getDay()], el("span", {}, shortDate(d)), k === hoy ? el("span", { class: "hoy" }, "Hoy") : null, climaDia(k)),
      cook));

    const plato = el("input", {
      class: "plato", id: "plato-" + k, type: "text", placeholder: "¿Qué comemos?", "aria-label": "Plato",
      onchange: e => { comida(k).plato = e.target.value.trim(); saveComida(k); },
      onkeydown: e => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("add-" + k).focus(); } }
    });
    plato.value = c.plato || "";
    card.appendChild(plato);

    const ul = el("ul", { class: "ings" });
    (c.ingredientes || []).forEach(ing => {
      const actualT = tipo(ing.tipo);
      const chip = el("select", {
        class: "chip", id: "tipo-" + k + "-" + ing.id, style: tvars(actualT), title: "Tocá para cambiar dónde se compra", "aria-label": "Dónde se compra " + nombreIng(ing),
        onchange: e => { ing.tipo = e.target.value; saveComida(k); }
      }, ...state.tipos.map(t => el("option", { value: t.id, selected: t.id === actualT.id }, t.nombre)));
      ul.appendChild(el("li", { class: "ing" + (ing.comprado ? " bought" : "") },
        chip,
        el("span", { class: "nm" }, nombreIng(ing), cantIng(ing) > 1 ? el("span", { class: "cant" }, " x" + cantIng(ing)) : null),
        el("button", {
          class: "x", "aria-label": "Quitar " + ing.nombre,
          onclick: () => { const cc = comida(k); cc.ingredientes = cc.ingredientes.filter(i => i.id !== ing.id); saveComida(k); }
        }, "×")));
    });
    card.appendChild(ul);

    const input = el("input", { id: "add-" + k, type: "text", placeholder: "Agregar ingrediente", "aria-label": "Nuevo ingrediente" });
    const add = () => {
      const v = input.value.trim(); if (!v) return;
      input.value = "";
      const { nombre, cantidad } = leerCantidad(v);
      comida(k).ingredientes = [...(comida(k).ingredientes || []), { id: uid(), nombre, cantidad, tipo: tipoDe(adivinarTipo(nombre)), comprado: false }];
      saveComida(k);
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    card.appendChild(el("div", { class: "addrow" }, input, el("button", { onclick: add, "aria-label": "Agregar" }, "+")));

    const foot = el("div", { class: "cardfoot" }, iconBtn(ICON_NOTA, c.notas ? "Ver notas" : "Agregar notas", () => voltear(k, section), !!c.notas));
    card.appendChild(foot);
    if (state.comidas[k]) {
      if (state.confirmar === k) {
        const ks = bloque(k);
        const hasta = parse(ks[ks.length - 1]);
        const libre = addDays(hasta, 1);
        const txt = ks.length === 1
          ? "Se pasa todo lo de este día al " + DIAS[libre.getDay()] + " " + shortDate(libre) + "."
          : "Se corren " + ks.length + " comidas, de este día hasta el " + DIAS[hasta.getDay()] + " " + shortDate(hasta) + ", un día para adelante. Lo último queda el " + DIAS[libre.getDay()] + " " + shortDate(libre) + ".";
        card.insertBefore(el("div", { class: "confirm" }, el("span", {}, txt + " Este día queda libre."),
          el("div", { class: "btns" },
            el("button", { class: "btn ghost", onclick: () => { state.confirmar = null; render(); } }, "Cancelar"),
            el("button", { class: "btn", onclick: () => correr(k) }, "Skip"))), foot);
      } else {
        foot.appendChild(el("button", { class: "linkbtn", title: "Pasar esta comida al día siguiente", onclick: () => { state.confirmar = k; render(); } }, "Skip →"));
      }
    }

    const back = el("div", { class: "face back" });
    back.appendChild(el("p", { class: "back-title" }, "Notas", el("span", {}, DIAS[d.getDay()] + " " + shortDate(d) + (c.plato ? " · " + c.plato : ""))));
    const notas = el("textarea", {
      class: "notas", id: "notas-" + k, placeholder: "Receta, link, qué sobró, para cuántos…", "aria-label": "Notas de la comida",
      onchange: e => { const v = e.target.value.trim(); if (v !== (comida(k).notas || "")) { comida(k).notas = v; saveComida(k); } }
    });
    notas.value = c.notas || "";
    back.appendChild(notas);
    back.appendChild(el("div", { class: "cardfoot" }, iconBtn(ICON_VOLVER, "Volver a la comida", () => { notas.blur(); voltear(k, section); }), el("span", { class: "hint" }, "Se guarda solo")));
    if (flipped.has(k)) card.inert = true; else back.inert = true;

    section.appendChild(el("div", { class: "flip" }, card, back));
    grid.appendChild(section);
  });
  const wrap = el("div", {}, grid);
  wrap.appendChild(el("p", { class: "hint", style: "margin-top:12px" }, "Tocá la etiqueta de cada ingrediente para elegir dónde se compra. Los lugares se arman con el botón de la bolsa, arriba."));
  return wrap;
}

// sugerencia inicial; se cambia tocando la etiqueta
const VERDU = /\b(cebolla|papa|zanahoria|tomate|morr[oó]n|pimiento|ajo|lechuga|zapallit|zapallo|zuchini|zucchini|berenjena|choclo|manzana|banana|naranja|lim[oó]n|hongo|champi|r[uú]cula|espinaca|acelga|apio|puerro|verdeo|perejil|albahaca|batata|palta|frutilla|pera|br[oó]coli|chaucha|huevo|repollo|remolacha|pepino)/i;
const CARNI = /\b(carne|bife|pollo|pechuga|milanesa|cerdo|bondiola|vac[ií]o|asado|nalga|peceto|cuadril|chorizo|morcilla|picada|molida|pata|muslo|costilla|matambre|lomo|osobuco|carr[eé])/i;
function adivinarTipo(t) { if (CARNI.test(t)) return "carni"; if (VERDU.test(t)) return "verdu"; return "super"; }

// "cebolla 2" es 2 cebollas para esa comida; el número tiene que ir al final, separado por un espacio
function leerCantidad(t) {
  const m = /^(.*\S)\s+(\d{1,3})$/.exec(t);
  return m && +m[2] > 0 ? { nombre: m[1], cantidad: +m[2] } : { nombre: t, cantidad: 1 };
}
// los cargados antes no tienen cantidad (es 1), o la tienen escrita en el nombre
const nombreIng = ing => ing.cantidad ? ing.nombre : leerCantidad(ing.nombre || "").nombre;
const cantIng = ing => ing.cantidad || leerCantidad(ing.nombre || "").cantidad;
const sumaCant = xs => xs.reduce((n, x) => n + cantIng(x.ing), 0);

// la semana que se ve y todo lo planeado después, así lo de la otra semana ya aparece en la lista
function itemsCompras() {
  const out = {};
  state.tipos.forEach(t => { out[t.id] = []; });
  const desde = key(state.weekStart), hasta = key(addDays(state.weekStart, 6));
  Object.keys(state.comidas).filter(k => k >= desde).sort().forEach(k => {
    const c = state.comidas[k], d = parse(k), nd = DIAS[d.getDay()];
    // "Martes 8"; lo de semanas siguientes lleva el mes: "Lunes 26 oct"
    const dia = nd[0].toUpperCase() + nd.slice(1) + " " + (k > hasta ? shortDate(d) : d.getDate());
    (c.ingredientes || []).forEach(ing => {
      out[tipoDe(ing.tipo)].push({ ing, k, plato: c.plato, dia });
    });
  });
  return out;
}
// "Zanahoria" y "zanahoria " son lo mismo: se juntan en un solo renglón con contador
const normal = t => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// "cebolla" y "cebollas", "limón" y "limones" también: cada palabra se lleva a una raíz común.
// Es solo para agrupar, no se muestra; las palabras de menos de 4 letras y las que terminan en -is o -us no se tocan
const raiz = w => {
  if (w.length < 4 || /(is|us|ss)$/.test(w)) return w;
  w = w.replace(/s$/, "");
  return w.replace(/ce$/, "z").replace(/([lnrdj])e$/, "$1");
};
const clave = t => normal(t).split(" ").map(raiz).join(" ");
function agrupar(list, nombre) {
  const g = new Map();
  list.forEach(x => { const n = clave(nombre(x)); if (!g.has(n)) g.set(n, []); g.get(n).push(x); });
  return [...g.values()];
}
// el nombre que más se repite en el grupo (con empate, el primero que se cargó)
function nombreComun(xs, nombre) {
  const c = new Map();
  xs.forEach(x => { const v = nombre(x).trim(); c.set(v, (c.get(v) || 0) + 1); });
  return [...c].reduce((a, b) => b[1] > a[1] ? b : a)[0];
}
const ingsAgrupados = it => state.tipos.reduce((o, t) => (o[t.id] = agrupar(it[t.id], x => nombreIng(x.ing)), o), {});
// las cosas sueltas de antes no tienen tipo: son del súper
const extrasAgrupados = t => agrupar(Object.entries(state.extras).filter(([, e]) => tipoDe(e.tipo) === t).sort((a, b) => (a[1].creado || 0) - (b[1].creado || 0)), ([, e]) => e.nombre);
function pendientes() {
  const g = ingsAgrupados(itemsCompras());
  let n = 0;
  state.tipos.forEach(t => {
    g[t.id].forEach(xs => { if (xs.some(x => !x.ing.comprado)) n++; });
    extrasAgrupados(t.id).forEach(es => { if (es.some(([, e]) => !e.comprado)) n++; });
  });
  return n;
}
// el contador suma las cantidades; si tiene onclick (más de una comida), abre el detalle para tachar de a una
const cuenta = (n, onclick) => n > 1 ? (onclick
  ? el("button", { class: "cuenta", title: "Ver cada comida", "aria-label": "Ver cada comida por separado", onclick: e => { e.preventDefault(); onclick(); } }, "x" + n)
  : el("span", { class: "cuenta" }, "x" + n)) : null;
// "Martes 8, Pollo con papas · Lunes 26 oct, Pollo" con el día en negrita
const porQue = xs => el("span", { class: "why" }, ...xs.flatMap((y, i) => [i ? " · " : null, el("b", {}, y.dia), y.plato ? ", " + y.plato : null]));
function marcarIngs(xs, v) {
  const ahora = Date.now();
  xs.forEach(y => { y.ing.comprado = v; y.ing.compradoEn = v ? ahora : null; });
  [...new Set(xs.map(y => y.k))].forEach(saveComida);
}
// los pendientes y los ya tachados de un mismo producto van en renglones separados, cada uno con su contador
const partir = (xs, hecho) => [xs.filter(x => !hecho(x)), xs.filter(hecho)].filter(p => p.length);

// pendientes arriba; de los tachados solo los últimos 3 (o 10 con "Ver más"), del más reciente al más viejo
const verMas = {};
function listaCompras(box, lk, rows) {
  const pend = rows.filter(r => !r.comprado);
  const done = rows.filter(r => r.comprado).sort((a, b) => (b.en || 0) - (a.en || 0));
  const abierto = !!verMas[lk];
  const visibles = done.slice(0, abierto ? 10 : 3);
  const ul = el("ul", { class: "items" });
  pend.forEach(r => ul.appendChild(r.li));
  visibles.forEach((r, i) => { if (!abierto) r.li.classList.add("fade-" + (i + 1)); ul.appendChild(r.li); });
  box.appendChild(ul);
  if (done.length > 3) {
    box.appendChild(el("div", { class: "vermas" }, el("button", {
      class: "linkbtn", onclick: () => { verMas[lk] = !abierto; render(); }
    }, abierto ? "Ver menos" : "Ver más tachados (" + (Math.min(done.length, 10) - 3) + ")")));
  }
}

function renderCompras() {
  const g = ingsAgrupados(itemsCompras());
  const shop = el("div", { class: "shop" });

  state.tipos.forEach(tp => {
    const t = tp.id, esSuper = t === "super";
    const list = g[t];
    const extras = extrasAgrupados(t);
    const total = list.length + extras.length;
    const faltan = list.filter(xs => xs.some(x => !x.ing.comprado)).length + extras.filter(es => es.some(([, e]) => !e.comprado)).length;
    // en el súper siempre se separa lo del menú de lo de la casa; en los demás, solo si hay de las dos cosas
    const separar = esSuper || (list.length && extras.length);
    const box = el("section", { class: "store", style: tvars(tp) });
    box.appendChild(el("div", { class: "store-head" }, el("h2", { class: tp.icono ? "has-icon" : null }, tp.icono ? el("span", { class: "ico", "aria-hidden": "true" }, tp.icono) : null, tp.nombre), el("span", { class: "n" }, total ? faltan + " de " + total + " por comprar" : "")));

    if (separar) box.appendChild(el("div", { class: "sub" }, "Para el menú"));
    if (!list.length && (esSuper || !extras.length)) box.appendChild(el("p", { class: "empty" }, esSuper ? "Nada del menú por ahora." : "Nada por ahora."));
    else if (list.length) {
      listaCompras(box, "menu-" + t, list.flatMap(xs => partir(xs, y => y.ing.comprado).map(ps => {
        const x = ps[0], comprado = !!x.ing.comprado, nom = nombreComun(xs, y => nombreIng(y.ing));
        const id = "chk-" + x.k + "-" + x.ing.id;
        const abrir = () => { state.detalle = { t, n: clave(nombreIng(x.ing)) }; render(); const f = sheetEl.querySelector("input"); if (f) f.focus(); };
        return { comprado, en: Math.max(...ps.map(y => y.ing.compradoEn || 0)), li: el("li", { class: "item" + (comprado ? " done" : "") },
          el("input", { type: "checkbox", id, checked: comprado, onchange: e => marcarIngs(ps, e.target.checked) }),
          el("label", { for: id }, el("span", { class: "what" }, nom, cuenta(sumaCant(ps), ps.length > 1 ? abrir : null)), porQue(ps))) };
      })));
    }

    if (separar) box.appendChild(el("div", { class: "sub" }, esSuper ? "Otras cosas para la casa" : "Otras cosas"));
    if (esSuper && !extras.length) box.appendChild(el("p", { class: "empty" }, "Sumá lo que falte: limpieza, desayuno, lo que sea."));
    else if (extras.length) {
      listaCompras(box, "extras-" + t, extras.flatMap(es => partir(es, ([, y]) => y.comprado).map(ps => {
        const [eid, e] = ps[0], comprado = !!e.comprado, nom = nombreComun(es, ([, y]) => y.nombre);
        const id = "ext-" + eid;
        const marcar = ev => {
          const v = ev.target.checked, ahora = Date.now();
          ps.forEach(([yid, y]) => { y.comprado = v; y.compradoEn = v ? ahora : null; saveExtra(yid); });
        };
        return { comprado, en: Math.max(...ps.map(([, y]) => y.compradoEn || 0)), li: el("li", { class: "item" + (comprado ? " done" : "") },
          el("input", { type: "checkbox", id, checked: comprado, onchange: marcar }),
          el("label", { for: id }, el("span", { class: "what" }, nom, cuenta(ps.length))),
          el("button", { class: "x", "aria-label": "Quitar " + nom, onclick: () => { ps.forEach(([yid]) => { delete state.extras[yid]; saveExtra(yid); }); } }, "×")) };
      })));
    }
    const input = el("input", { id: "add-extra-" + t, type: "text", placeholder: esSuper ? "Ej: lavandina, yerba, papel" : "Agregar a " + tp.nombre, "aria-label": "Agregar a la lista de " + tp.nombre });
    const add = () => {
      const v = input.value.trim(); if (!v) return;
      input.value = "";
      const eid = uid();
      state.extras[eid] = { nombre: v, tipo: t, comprado: false, creado: Date.now() };
      saveExtra(eid);
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    box.appendChild(el("div", { class: "addrow" }, input, el("button", { onclick: add, "aria-label": "Agregar" }, "+")));
    const comprados = Object.keys(state.extras).filter(eid => state.extras[eid].comprado && tipoDe(state.extras[eid].tipo) === t);
    if (comprados.length) {
      box.appendChild(el("div", { class: "tools" }, el("button", {
        class: "linkbtn",
        onclick: () => { comprados.forEach(eid => { delete state.extras[eid]; saveExtra(eid); }); }
      }, "Borrar lo ya comprado")));
    }
    shop.appendChild(box);
  });
  return shop;
}

// cada comida que lleva un producto repetido, con su cantidad, para tachar de a una
function renderDetalle() {
  const { t, n } = state.detalle;
  const xs = (itemsCompras()[t] || []).filter(x => clave(nombreIng(x.ing)) === n);
  if (!xs.length) { state.detalle = null; return; }
  const cerrar = () => { state.detalle = null; render(); };
  sheetEl.appendChild(el("div", { class: "scrim", onclick: cerrar }));
  const nom = nombreComun(xs, x => nombreIng(x.ing));
  const box = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": nom });
  const faltan = xs.filter(x => !x.ing.comprado).length;
  box.appendChild(el("div", { class: "sheet-head" }, el("h2", {}, nom, el("span", { class: "cuenta" }, "x" + sumaCant(xs))), el("button", { class: "x", "aria-label": "Cerrar", onclick: cerrar }, "×")));
  box.appendChild(el("p", { class: "hint" }, faltan ? (faltan === 1 ? "Falta 1 comida" : "Faltan " + faltan + " comidas") + " de " + xs.length + ". Tachá cada una por separado." : "Ya está todo tachado."));
  const ul = el("ul", { class: "items" });
  xs.forEach(x => {
    const id = "det-" + x.k + "-" + x.ing.id;
    ul.appendChild(el("li", { class: "item" + (x.ing.comprado ? " done" : "") },
      el("input", { type: "checkbox", id, checked: !!x.ing.comprado, onchange: e => marcarIngs([x], e.target.checked) }),
      el("label", { for: id }, el("span", { class: "what" }, nombreIng(x.ing), cuenta(cantIng(x.ing))), porQue([x]))));
  });
  box.appendChild(ul);
  box.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
  sheetEl.appendChild(box);
}

// ---------- navegación ----------
document.getElementById("prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
document.getElementById("next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };
document.getElementById("hoy").onclick = () => { state.weekStart = monday(new Date()); render(); };
function setTab(t) { state.tab = t; try { localStorage.setItem("tab", t); } catch (e) {} render(); }
function abrirMenu(m) { state.menu = m; state.quitar = null; render(); const f = sheetEl.querySelector("input"); if (f) f.focus(); }
document.getElementById("menuPersonas").onclick = () => abrirMenu("personas");
document.getElementById("menuTipos").onclick = () => abrirMenu("tipos");
document.getElementById("tab-semana").onclick = () => setTab("semana");
document.getElementById("tab-compras").onclick = () => setTab("compras");
// al volver a la app después de días, que "Hoy" sea hoy
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") render(); });

// ---------- login ----------
const loginEl = document.getElementById("login");
const appEl = document.getElementById("app");
const loginErr = document.getElementById("loginErr");
document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; loginErr.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, document.getElementById("loginEmail").value.trim(), document.getElementById("loginPass").value);
  } catch (err) {
    const c = err && err.code;
    loginErr.textContent = c === "auth/network-request-failed" ? "No hay conexión. Probá de nuevo."
      : c === "auth/too-many-requests" ? "Demasiados intentos. Esperá un rato y probá de nuevo."
      : "Mail o contraseña incorrectos.";
    loginErr.hidden = false;
  }
  btn.disabled = false;
});

// ---------- conexión ----------
let unsubs = [];
onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  loginEl.hidden = !!user; appEl.hidden = !user;
  if (!user) { state.comidas = {}; state.extras = {}; state.menu = false; document.getElementById("loginPass").value = ""; return; }
  const onErr = err => {
    console.error(err);
    state.error = err && err.code === "permission-denied"
      ? "Esta cuenta no tiene acceso a los datos compartidos. Pedile a quien armó la app que la habilite."
      : "Se cortó la conexión con los datos compartidos. Recargá la página.";
    render();
  };
  unsubs.push(onSnapshot(collection(fs, "comidas"), snap => {
    const m = {};
    snap.docs.forEach(d => { m[d.id] = d.data(); });
    state.comidas = m; render();
  }, onErr));
  unsubs.push(onSnapshot(doc(fs, "config", "personas"), snap => {
    const l = snap.exists() && snap.data().lista;
    if (Array.isArray(l) && l.length) { state.personas = l; render(); }
  }, onErr));
  unsubs.push(onSnapshot(doc(fs, "config", "tipos"), snap => {
    // si todavía no se guardó nunca, quedan los tres de siempre
    const l = snap.exists() && snap.data().lista;
    if (Array.isArray(l) && l.some(t => t.id === "super")) { state.tipos = l; render(); }
  }, onErr));
  unsubs.push(onSnapshot(collection(fs, "extras"), snap => {
    const m = {};
    snap.docs.forEach(d => { m[d.id] = d.data(); });
    state.extras = m; render();
  }, onErr));
  render();
});
