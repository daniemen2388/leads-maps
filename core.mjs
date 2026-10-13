// Núcleo de Leads Maps: lanza gosom/google-maps-scraper en Docker y lee sus resultados.
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const IMAGEN = "gosom/google-maps-scraper";
export const DIR_BUSQUEDAS = join(import.meta.dirname, "busquedas");

export const ZONAS = {
  Barcelona: [
    "Ciutat Vella", "Eixample", "Sants", "Montjuic", "Les Corts", "Sarria", "Sant Gervasi",
    "Gracia", "Horta", "Guinardo", "Nou Barris", "Sant Andreu", "Sant Marti", "Poblenou",
    "Barceloneta", "El Born", "Raval", "Sagrada Familia", "Clot", "Pedralbes",
  ],
  Madrid: [
    "Centro", "Arganzuela", "Retiro", "Salamanca", "Chamartin", "Tetuan", "Chamberi",
    "Fuencarral", "Moncloa", "Latina", "Carabanchel", "Usera", "Puente de Vallecas",
    "Moratalaz", "Ciudad Lineal", "Hortaleza", "Villaverde", "Vicalvaro", "San Blas", "Barajas",
  ],
  Valencia: [
    "Ciutat Vella", "Eixample", "Extramurs", "Campanar", "La Saidia", "Pla del Real",
    "Olivereta", "Patraix", "Jesus", "Quatre Carreres", "Poblats Maritims", "Camins al Grau",
    "Algiros", "Benimaclet", "Rascanya", "Benicalap",
  ],
};

// --- Barrios de cualquier ciudad (OpenStreetMap: Nominatim + Overpass), con caché en disco ---
const UA = { "User-Agent": "LeadsMaps/1.0 (herramienta local)" };
const DIR_CACHE = join(import.meta.dirname, "cache");
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
async function pedir(url, opc = {}, intentos = 3) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000), ...opc }); if (r.ok) return r; throw new Error(`HTTP ${r.status}`); }
    catch (e) { if (i >= intentos - 1) throw e; await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); }
  }
}
const limpio = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function overpass(q) {
  let ultimo;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", headers: UA, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(60000) });
      const t = await r.text();
      if (t.trim().startsWith("{")) return JSON.parse(t);
      ultimo = new Error("Overpass ocupado");
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

export async function barriosDe(ciudad, pais = "es") {
  mkdirSync(DIR_CACHE, { recursive: true });
  const ruta = join(DIR_CACHE, `${pais}-${limpio(ciudad)}.json`);
  if (existsSync(ruta)) return JSON.parse(readFileSync(ruta, "utf8"));
  const n = await (await pedir(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=${pais}&q=${encodeURIComponent(ciudad)}`)).json();
  const lugar = n.find((x) => x.osm_type === "relation" && ["city", "town", "village", "municipality"].includes(x.addresstype)) || n.find((x) => x.osm_type === "relation");
  if (!lugar) throw new Error(`No encuentro «${ciudad}» en España`);
  const area = 3600000000 + Number(lugar.osm_id);
  const o = await overpass(`[out:json][timeout:60];area(${area})->.a;(relation["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.a);node["place"~"^(suburb|quarter)$"](area.a););out tags center;`);
  const punto = (e) => ({ nombre: e.tags.name, lat: e.center?.lat ?? e.lat, lng: e.center?.lon ?? e.lon });
  const uniq = (l) => [...new Map(l.filter((x) => x.nombre).map((x) => [x.nombre, x])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const distritos = uniq(o.elements.filter((e) => e.type === "relation" && e.tags.admin_level === "9").map(punto));
  let barrios = uniq(o.elements.filter((e) => e.type === "relation" && e.tags.admin_level === "10").map(punto));
  if (barrios.length < 3) barrios = uniq(o.elements.filter((e) => e.type === "node").map(punto));
  const bb = lugar.boundingbox.map(Number);
  const datos = { ciudad: lugar.name, nombreCompleto: lugar.display_name, centro: [Number(lugar.lat), Number(lugar.lon)], limites: [[bb[0], bb[2]], [bb[1], bb[3]]], distritos, barrios };
  writeFileSync(ruta, JSON.stringify(datos));
  return datos;
}

export async function zonaEnPunto(lat, lng) {
  const r = await (await pedir(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${lat}&lon=${lng}`)).json();
  const a = r.address || {};
  return { nombre: a.neighbourhood || a.quarter || a.suburb || a.city_district || a.postcode || r.name, cp: a.postcode || "", lat, lng };
}

const trabajos = new Map(); // id -> { proc, contenedor, estado, inicio, fin, error }

export function crearBusqueda({ sector, ciudad, zonas = [], puntos = [], profundidad = 3, emails = true, idioma = "es" }) {
  if (!sector || !ciudad) throw new Error("Faltan sector o ciudad");
  const id = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const dir = join(DIR_BUSQUEDAS, id);
  mkdirSync(dir, { recursive: true });
  const lista = zonas.length ? zonas : [""];
  const consultas = lista.map((z) => [sector, z, ciudad].filter(Boolean).join(" "));
  writeFileSync(join(dir, "queries.txt"), consultas.join("\n") + "\n", "ascii");
  const meta = { id, sector, ciudad, zonas, puntos, profundidad, emails, consultas, inicio: Date.now() };
  writeFileSync(join(dir, "busqueda.json"), JSON.stringify(meta, null, 2));

  const contenedor = `leadsmaps-${id}`;
  const args = [
    "run", "--rm", "--name", contenedor,
    "-v", "gmaps-playwright-cache:/opt",
    "-v", `${dir}:/out`,
    IMAGEN,
    "-input", "/out/queries.txt",
    "-results", "/out/results.csv",
    "-depth", String(profundidad),
    "-lang", idioma,
    "-c", "4",
    "-exit-on-inactivity", "3m",
  ];
  if (emails) args.push("-email");
  const proc = spawn("docker", args, { windowsHide: true });
  const t = { proc, contenedor, estado: "buscando", inicio: Date.now(), fin: null, error: "" };
  proc.stderr.on("data", (d) => { const s = d.toString(); if (/error/i.test(s) && !/job finished/.test(s)) t.error = s.slice(-300); });
  proc.on("close", (code) => {
    t.estado = code === 0 ? "terminada" : (t.estado === "parada" ? "parada" : "error");
    t.fin = Date.now();
    writeFileSync(join(dir, "estado.json"), JSON.stringify({ estado: t.estado, fin: t.fin }));
  });
  trabajos.set(id, t);
  return meta;
}

export function pararBusqueda(id) {
  const t = trabajos.get(id);
  if (!t) return false;
  t.estado = "parada";
  execFile("docker", ["stop", t.contenedor], () => {});
  return true;
}

export function estadoBusqueda(id) {
  const dir = join(DIR_BUSQUEDAS, id);
  if (!existsSync(join(dir, "busqueda.json"))) return null;
  const meta = JSON.parse(readFileSync(join(dir, "busqueda.json"), "utf8"));
  const t = trabajos.get(id);
  let estado = t?.estado, fin = t?.fin;
  if (!estado) {
    const guardado = existsSync(join(dir, "estado.json")) ? JSON.parse(readFileSync(join(dir, "estado.json"), "utf8")) : {};
    estado = guardado.estado || "terminada"; fin = guardado.fin || meta.inicio;
  }
  const negocios = leerResultados(join(dir, "results.csv"));
  return { ...meta, estado, error: t?.error || "", segundos: Math.round(((fin || Date.now()) - meta.inicio) / 1000), negocios };
}

export function listarBusquedas() {
  if (!existsSync(DIR_BUSQUEDAS)) return [];
  return readdirSync(DIR_BUSQUEDAS).filter((d) => existsSync(join(DIR_BUSQUEDAS, d, "busqueda.json")))
    .map((d) => JSON.parse(readFileSync(join(DIR_BUSQUEDAS, d, "busqueda.json"), "utf8")))
    .sort((a, b) => b.inicio - a.inicio);
}

// --- CSV ---
export function parseCSV(texto) {
  const filas = []; let fila = []; let campo = ""; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const EMAIL_BASURA = /\.(png|jpe?g|gif|svg|webp)$|@(sentry|wixpress|example|webador|domain)\.|^(soporte|support)@/i;

export function leerResultados(ruta) {
  if (!existsSync(ruta)) return [];
  const filas = parseCSV(readFileSync(ruta, "utf8"));
  if (filas.length < 2) return [];
  const cab = filas[0];
  const i = (n) => cab.indexOf(n);
  const vistos = new Set(); const out = [];
  for (const f of filas.slice(1)) {
    if (f.length < cab.length - 1) continue; // fila a medio escribir
    const clave = f[i("place_id")] || f[i("link")] || f[i("title")];
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    const emails = (f[i("emails")] || "").split(/[,;\s]+/).map((e) => e.trim()).filter((e) => e.includes("@") && !EMAIL_BASURA.test(e));
    out.push({
      nombre: f[i("title")] || "",
      categoria: f[i("category")] || "",
      direccion: f[i("address")] || "",
      telefono: f[i("phone")] || "",
      web: f[i("website")] || "",
      emails: [...new Set(emails)].join(", "),
      nota: parseFloat(f[i("review_rating")]) || 0,
      resenas: parseInt(f[i("review_count")]) || 0,
      maps: f[i("link")] || "",
      lat: parseFloat(f[i("latitude")]) || null,
      lng: parseFloat(f[i("longitude")]) || null,
    });
  }
  return out;
}

export function aCSV(negocios) {
  const cols = ["nombre", "categoria", "direccion", "telefono", "web", "emails", "nota", "resenas", "maps"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [cols.join(";"), ...negocios.map((n) => cols.map((c) => esc(n[c])).join(";"))].join("\r\n");
}

export function filtrar(negocios, { maxResenas, minNota, maxNota, conEmail, sinWeb, conTelefono } = {}) {
  return negocios.filter((n) =>
    (maxResenas == null || maxResenas === "" || n.resenas <= Number(maxResenas)) &&
    (minNota == null || minNota === "" || n.nota >= Number(minNota)) &&
    (maxNota == null || maxNota === "" || n.nota <= Number(maxNota)) &&
    (!conEmail || n.emails) && (!sinWeb || !n.web) && (!conTelefono || n.telefono));
}
