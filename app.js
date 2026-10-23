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
const TIPOS = { super: "Súper", verdu: "Verdulería", carni: "Carnicería" };
const ORDEN_TIPOS = ["super", "verdu", "carni"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const state = { personas: PERSONAS_INICIALES.map(p => ({ ...p })), menu: false, quitar: null, comidas: {}, extras: {}, tab: "semana", weekStart: monday(new Date()) };
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
  const data = { version: 1, exportado: new Date().toISOString(), personas: state.personas, comidas: state.comidas, extras: state.extras };
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
    (state.tab === "semana" ? "Menú de la semana" : "Compras de la semana") +
    "<small>" + shortDate(days[0]) + " al " + shortDate(days[6]) + " " + days[6].getFullYear() + "</small>";
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
  view.appendChild(state.tab === "semana" ? renderSemana(days) : renderCompras(days));
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
  if (!state.menu) return;
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

function renderSemana(days) {
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
      el("div", { class: "day-name" }, DIAS[d.getDay()], el("span", {}, shortDate(d)), k === hoy ? el("span", { class: "hoy" }, "Hoy") : null),
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
      ul.appendChild(el("li", { class: "ing" + (ing.comprado ? " bought" : "") },
        el("button", {
          class: "chip t-" + ing.tipo, title: "Tocá para cambiar dónde se compra",
          onclick: () => { ing.tipo = ORDEN_TIPOS[(ORDEN_TIPOS.indexOf(ing.tipo) + 1) % 3]; saveComida(k); }
        }, TIPOS[ing.tipo] || "Súper"),
        el("span", { class: "nm" }, ing.nombre),
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
      comida(k).ingredientes = [...(comida(k).ingredientes || []), { id: uid(), nombre: v, tipo: adivinarTipo(v), comprado: false }];
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
  wrap.appendChild(el("p", { class: "hint", style: "margin-top:12px" }, "Tocá la etiqueta de cada ingrediente para elegir si va a la verdulería, la carnicería o el súper."));
  return wrap;
}

// sugerencia inicial; se cambia tocando la etiqueta
const VERDU = /\b(cebolla|papa|zanahoria|tomate|morr[oó]n|pimiento|ajo|lechuga|zapallit|zapallo|zuchini|zucchini|berenjena|choclo|manzana|banana|naranja|lim[oó]n|hongo|champi|r[uú]cula|espinaca|acelga|apio|puerro|verdeo|perejil|albahaca|batata|palta|frutilla|pera|br[oó]coli|chaucha|huevo|repollo|remolacha|pepino)/i;
const CARNI = /\b(carne|bife|pollo|pechuga|milanesa|cerdo|bondiola|vac[ií]o|asado|nalga|peceto|cuadril|chorizo|morcilla|picada|molida|pata|muslo|costilla|matambre|lomo|osobuco|carr[eé])/i;
function adivinarTipo(t) { if (CARNI.test(t)) return "carni"; if (VERDU.test(t)) return "verdu"; return "super"; }

function itemsSemana(days) {
  const out = { super: [], verdu: [], carni: [] };
  days.forEach(d => {
    const k = key(d), c = state.comidas[k];
    if (!c) return;
    (c.ingredientes || []).forEach(ing => {
      out[ing.tipo in out ? ing.tipo : "super"].push({ ing, k, plato: c.plato, dia: DIAS[d.getDay()] });
    });
  });
  return out;
}
function pendientes() {
  const it = itemsSemana(weekDays());
  let n = 0;
  ORDEN_TIPOS.forEach(t => it[t].forEach(x => { if (!x.ing.comprado) n++; }));
  Object.values(state.extras).forEach(e => { if (!e.comprado) n++; });
  return n;
}

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

function renderCompras(days) {
  const it = itemsSemana(days);
  const shop = el("div", { class: "shop" });
  const extras = Object.entries(state.extras).sort((a, b) => (a[1].creado || 0) - (b[1].creado || 0));

  ["super", "verdu", "carni"].forEach(t => {
    const list = it[t].slice().sort((a, b) => a.ing.comprado - b.ing.comprado);
    const extrasT = t === "super" ? extras : [];
    const total = list.length + extrasT.length;
    const faltan = list.filter(x => !x.ing.comprado).length + extrasT.filter(([, e]) => !e.comprado).length;
    const box = el("section", { class: "store s-" + t });
    box.appendChild(el("div", { class: "store-head" }, el("h2", {}, TIPOS[t]), el("span", { class: "n" }, total ? faltan + " de " + total + " por comprar" : "")));

    if (t === "super") box.appendChild(el("div", { class: "sub" }, "Para el menú"));
    if (!list.length) box.appendChild(el("p", { class: "empty" }, "Nada del menú de esta semana."));
    else {
      listaCompras(box, "menu-" + t, list.map(x => {
        const id = "chk-" + x.k + "-" + x.ing.id;
        return { comprado: !!x.ing.comprado, en: x.ing.compradoEn, li: el("li", { class: "item" + (x.ing.comprado ? " done" : "") },
          el("input", { type: "checkbox", id, checked: !!x.ing.comprado, onchange: e => { x.ing.comprado = e.target.checked; x.ing.compradoEn = e.target.checked ? Date.now() : null; saveComida(x.k); } }),
          el("label", { for: id }, el("span", { class: "what" }, x.ing.nombre), el("span", { class: "why" }, x.dia + (x.plato ? " · " + x.plato : "")))) };
      }));
    }

    if (t === "super") {
      box.appendChild(el("div", { class: "sub" }, "Otras cosas para la casa"));
      if (!extras.length) box.appendChild(el("p", { class: "empty" }, "Sumá lo que falte: limpieza, desayuno, lo que sea."));
      else {
        listaCompras(box, "extras", extras.map(([eid, e]) => {
          const id = "ext-" + eid;
          return { comprado: !!e.comprado, en: e.compradoEn, li: el("li", { class: "item" + (e.comprado ? " done" : "") },
            el("input", { type: "checkbox", id, checked: !!e.comprado, onchange: ev => { e.comprado = ev.target.checked; e.compradoEn = ev.target.checked ? Date.now() : null; saveExtra(eid); } }),
            el("label", { for: id }, el("span", { class: "what" }, e.nombre)),
            el("button", { class: "x", "aria-label": "Quitar " + e.nombre, onclick: () => { delete state.extras[eid]; saveExtra(eid); } }, "×")) };
        }));
      }
      const input = el("input", { id: "add-extra", type: "text", placeholder: "Ej: lavandina, yerba, papel", "aria-label": "Agregar a la lista del súper" });
      const add = () => {
        const v = input.value.trim(); if (!v) return;
        input.value = "";
        const eid = uid();
        state.extras[eid] = { nombre: v, comprado: false, creado: Date.now() };
        saveExtra(eid);
      };
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      box.appendChild(el("div", { class: "addrow" }, input, el("button", { onclick: add, "aria-label": "Agregar" }, "+")));
      if (extras.some(([, e]) => e.comprado)) {
        box.appendChild(el("div", { class: "tools" }, el("button", {
          class: "linkbtn",
          onclick: () => { extras.filter(([, e]) => e.comprado).forEach(([eid]) => { delete state.extras[eid]; saveExtra(eid); }); }
        }, "Borrar lo ya comprado")));
      }
    }
    shop.appendChild(box);
  });
  return shop;
}

// ---------- navegación ----------
document.getElementById("prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
document.getElementById("next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };
document.getElementById("hoy").onclick = () => { state.weekStart = monday(new Date()); render(); };
function setTab(t) { state.tab = t; try { localStorage.setItem("tab", t); } catch (e) {} render(); }
document.getElementById("menuPersonas").onclick = () => { state.menu = true; render(); const f = sheetEl.querySelector("input"); if (f) f.focus(); };
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
  unsubs.push(onSnapshot(collection(fs, "extras"), snap => {
    const m = {};
    snap.docs.forEach(d => { m[d.id] = d.data(); });
    state.extras = m; render();
  }, onErr));
  render();
});
