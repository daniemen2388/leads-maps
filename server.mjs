// Leads Maps: servidor local. Uso: node server.mjs  →  http://localhost:4580
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crearBusqueda, pararBusqueda, estadoBusqueda, listarBusquedas, ZONAS, aCSV, filtrar, barriosDe, zonaEnPunto } from "./core.mjs";

const PUERTO = Number(process.env.PORT || 4580);
const HTML = join(import.meta.dirname, "public", "index.html");

const json = (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
const cuerpo = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(HTML));
    }
    if (p === "/api/zonas") return json(res, 200, ZONAS);
    if (p === "/api/barrios") return json(res, 200, await barriosDe(url.searchParams.get("ciudad") || ""));
    if (p === "/api/zona") return json(res, 200, await zonaEnPunto(url.searchParams.get("lat"), url.searchParams.get("lng")));
    if (p === "/api/busquedas" && req.method === "GET") return json(res, 200, listarBusquedas());
    if (p === "/api/buscar" && req.method === "POST") return json(res, 200, crearBusqueda(await cuerpo(req)));
    const m = p.match(/^\/api\/busqueda\/(\d{14})(\/parar|\/csv)?$/);
    if (m) {
      if (m[2] === "/parar") return json(res, 200, { ok: pararBusqueda(m[1]) });
      const e = estadoBusqueda(m[1]);
      if (!e) return json(res, 404, { error: "No existe" });
      if (m[2] === "/csv") {
        const f = Object.fromEntries(url.searchParams);
        const datos = filtrar(e.negocios, { ...f, conEmail: f.conEmail === "1", sinWeb: f.sinWeb === "1", conTelefono: f.conTelefono === "1" });
        const nombre = `leads-${e.sector}-${e.ciudad}-${e.id}.csv`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-");
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"` });
        return res.end(aCSV(datos));
      }
      return json(res, 200, e);
    }
    json(res, 404, { error: "Ruta no encontrada" });
  } catch (err) { json(res, 400, { error: err.message }); }
}).listen(PUERTO, "127.0.0.1", () => console.log(`Leads Maps en http://localhost:${PUERTO}`));
