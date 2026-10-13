---
name: leads-maps
description: Saca negocios de Google Maps (teléfono, web, email, reseñas) con Leads Maps, gratis y en local, y filtra los que son buenos leads (pocas reseñas, sin web). Usar cuando el usuario pida leads, clientes potenciales o negocios de un sector en una ciudad, barrio o código postal ("sácame las clínicas dentales de Barcelona con pocas reseñas").
---

# Leads Maps

Leads Maps es una app local (interfaz web + servidor Node) que usa la herramienta gratuita y de código abierto `gosom/google-maps-scraper` en Docker.

## Antes de empezar
1. Comprueba que Docker está en marcha: `docker info`. Si no, pide al usuario que abra Docker Desktop.
2. Localiza la carpeta de la app (la que contiene `server.mjs`). Si no sabes dónde está, pregunta.
3. Arranca el servidor si no responde `http://localhost:4580/api/zonas`: `node server.mjs` desde esa carpeta (en segundo plano).
4. Dile al usuario que puede ver el progreso en directo en http://localhost:4580 (tabla y mapa).

## Lanzar una búsqueda
`POST http://localhost:4580/api/buscar` con JSON:
```json
{ "sector": "clínica dental", "ciudad": "Barcelona", "zonas": ["Eixample", "Gracia", "08036"], "profundidad": 3, "emails": true }
```
- `zonas`: barrios o códigos postales. Si el usuario no dice nada y la ciudad está en `GET /api/zonas`, usa todos sus barrios.
- `profundidad`: 1 rápida, 3 normal, 5 a fondo.
- Devuelve un `id`.

## Seguir y leer resultados
- `GET /api/busqueda/<id>` → `estado` (buscando / terminada / parada / error), `segundos` y `negocios` (nombre, dirección, teléfono, web, emails, nota, reseñas, enlace de Maps, lat, lng).
- Consulta cada 30–60 s mientras `estado` sea `buscando`. Una búsqueda de 20 zonas a profundidad 3 tarda unos 15–25 min.
- `GET /api/busqueda/<id>/parar` la detiene.
- `GET /api/busqueda/<id>/csv?maxResenas=50&conEmail=1&sinWeb=0` descarga el Excel (CSV con `;`) ya filtrado.

## Qué entregar
- Resumen corto: cuántos negocios, cuántos con email, cuántos sin web y cuántos "leads calientes" (≤ 50 reseñas o sin web, o el filtro que pida el usuario).
- Los 10 mejores leads en una tabla y la ruta o enlace del Excel.
- Avisa de que algunos emails pueden ser de la agencia que hizo la web: revisarlos antes de escribir.
