(function () {
  'use strict';

  // ============ 1) DATOS GEOGRÁFICOS (incrustados) ============
  // GEO.deps: 18 departamentos | GEO.dist: 247 distritos | GEO.vecinos: países vecinos
  // GEO.ciudades: cada ciudad con nombre (n), latitud (lat), longitud (lon), departamento (dep) y tamaño (g: 1 grande, 3 chica)
  const CIUDADES = GEO.ciudades;
  const porNombre = new Map(CIUDADES.map(c => [c.n, c]));
  const $ = id => document.getElementById(id);
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (v, a, b) => limitar((v - a) / (b - a), 0, 1);
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const REDUCIDO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INTERVALO = 30 * 60 * 1000;   // cada cuánto se actualiza solo
  const nombreDep = n => n === 'Asunción' ? 'Asunción (capital)' : n;

  // ============ 2) CAPAS DEL MAPA ============
  // Cada capa dice qué dato mostrar, en qué rango y con qué colores.
  const CAPAS = {
    temp: { icono: '🌡️', nombre: 'Temperatura', campo: 'temperature_2m', min: 5, max: 40, dec: 0, corto: '°', largo: '°C',
      color: v => `hsl(${Math.round(225 - norm(v, 5, 40) * 225)}, 85%, 55%)`, alto: '🔥 Más calurosa', bajo: '❄️ Más fría' },
    humedad: { icono: '💧', nombre: 'Humedad', campo: 'relative_humidity_2m', min: 20, max: 100, dec: 0, corto: '%', largo: '%',
      color: v => `hsl(${Math.round(45 + norm(v, 20, 100) * 170)}, 75%, 55%)`, alto: '💧 Más húmeda', bajo: '🏜️ Más seca' },
    viento: { icono: '💨', nombre: 'Viento', campo: 'wind_speed_10m', min: 0, max: 40, dec: 0, corto: ' km/h', largo: ' km/h',
      color: v => `hsl(${Math.round(165 + norm(v, 0, 40) * 135)}, 75%, 55%)`, alto: '💨 Más ventosa', bajo: '🍃 Más calma' },
    lluvia: { icono: '🌧️', nombre: 'Lluvia', campo: 'precipitation', min: 0, max: 4, dec: 1, corto: ' mm', largo: ' mm',
      color: v => { const x = norm(v, 0, 4); return `hsl(210, ${Math.round(18 + x * 67)}%, ${Math.round(68 - x * 30)}%)`; },
      alto: '🌧️ Más lluvia', bajo: '☀️ Más seca' }
  };
  let capaId = 'temp';
  const capa = () => CAPAS[capaId];
  const esNumero = v => typeof v === 'number' && isFinite(v);
  const fmt = (v, largo) => {
    if (!esNumero(v)) return '--';
    const c = capa();
    const x = capaId === 'temp' ? aU(v) : v;
    return (c.dec ? x.toFixed(c.dec) : Math.round(x)) + (capaId === 'temp' && largo ? '°' + UT() : largo ? c.largo : c.corto);
  };
  let usaF = leer('clima-py-f', '0') === '1';          // °F o °C (los datos siempre se guardan en °C)
  const aU = t => usaF ? t * 9 / 5 + 32 : t;
  const UT = () => usaF ? 'F' : 'C';
  const grados = t => esNumero(t) ? Math.round(aU(t)) + '°' : '--';

  // ============ 3) ESTADO DE LA APP ============
  function leer(clave, def) { try { return localStorage.getItem(clave) || def; } catch (e) { return def; } }
  function leerJSON(clave, def) { try { return JSON.parse(localStorage.getItem(clave)) || def; } catch (e) { return def; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch (e) { /* si el navegador no deja guardar, no pasa nada */ } }

  const hashInicial = new URLSearchParams(location.hash.slice(1));
  let datos = {};                         // nombre de ciudad -> clima actual
  let seleccionada = hashInicial.get('c') || leer('clima-py-ultima', 'Asunción');
  if (!porNombre.has(seleccionada)) seleccionada = 'Asunción';
  if (CAPAS[hashInicial.get('capa')]) capaId = hashInicial.get('capa');
  let favoritas = new Set(leerJSON('clima-py-favs', []));
  let depFiltro = '';                     // departamento filtrado ('' = todos)
  let consulta = '';                      // texto del buscador (en minúsculas)
  let pestana = 'horas';                  // pestaña del pronóstico
  let detalleActual = null;               // último detalle cargado {c, d}
  let tokenDetalle = 0;                   // sirve para ignorar respuestas viejas
  let hover = null;                       // ciudad sobre la que está el mouse en la lista
  let ultimaOk = 0, ultimoError = false, cargando = false, ultimoIntento = 0, hayDatos = false;
  const cacheDetalle = new Map();
  let horaMapa = 0, horas = null, horasT = 0, pHoras = null;   // deslizador: 0 = ahora, 1..24 = horas por delante

  // Memoria sin internet: al abrir, se muestra el último clima guardado
  (function restaurar() {
    const g = leerJSON('clima-py-datos', null);
    if (g && g.datos && g.t) { datos = g.datos; ultimaOk = g.t; hayDatos = true; ultimoError = !navigator.onLine; }
  })();

  // ============ 4) FUNCIONES AUXILIARES ============
  const CODIGOS = {
    0: ['☀️', '🌙', 'Despejado'], 1: ['🌤️', '🌙', 'Mayormente despejado'], 2: ['⛅', '☁️', 'Parcialmente nublado'],
    3: ['☁️', '☁️', 'Nublado'], 45: ['🌫️', '🌫️', 'Niebla'], 48: ['🌫️', '🌫️', 'Niebla con escarcha'],
    51: ['🌦️', '🌧️', 'Llovizna leve'], 53: ['🌦️', '🌧️', 'Llovizna'], 55: ['🌧️', '🌧️', 'Llovizna fuerte'],
    56: ['🌧️', '🌧️', 'Llovizna helada'], 57: ['🌧️', '🌧️', 'Llovizna helada fuerte'],
    61: ['🌧️', '🌧️', 'Lluvia leve'], 63: ['🌧️', '🌧️', 'Lluvia'], 65: ['🌧️', '🌧️', 'Lluvia fuerte'],
    66: ['🌧️', '🌧️', 'Lluvia helada'], 67: ['🌧️', '🌧️', 'Lluvia helada fuerte'],
    71: ['🌨️', '🌨️', 'Nieve leve'], 73: ['🌨️', '🌨️', 'Nieve'], 75: ['🌨️', '🌨️', 'Nieve fuerte'], 77: ['🌨️', '🌨️', 'Granizo fino'],
    80: ['🌦️', '🌧️', 'Chubascos leves'], 81: ['🌧️', '🌧️', 'Chubascos'], 82: ['⛈️', '⛈️', 'Chubascos fuertes'],
    85: ['🌨️', '🌨️', 'Chubascos de nieve'], 86: ['🌨️', '🌨️', 'Chubascos de nieve fuertes'],
    95: ['⛈️', '⛈️', 'Tormenta'], 96: ['⛈️', '⛈️', 'Tormenta con granizo'], 99: ['⛈️', '⛈️', 'Tormenta fuerte con granizo']
  };
  function clima(codigo, esDia) {
    const c = CODIGOS[codigo] || ['🌡️', '🌡️', 'Sin datos'];
    return { emoji: esDia === 0 ? c[1] : c[0], texto: c[2] };
  }
  const dirViento = g => esNumero(g) ? ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(g / 45) % 8] : '';
  const fmtHora = f => f.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false });

  function aviso(texto) {
    const el = $('aviso');
    el.textContent = texto;
    el.style.display = 'block';
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { el.style.display = 'none'; }, 4500);
  }
  const anunciar = t => { $('anuncio').textContent = t; };

  // Distancia entre dos puntos de la Tierra (fórmula de Haversine), en km
  function distanciaKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }

  // Valor de la capa actual para una ciudad (o null si no hay dato)
  function valor(c) {
    if (horaMapa > 0 && horas && horas[c.n]) {
      const v = horas[c.n][capa().campo][indiceAhora(c.n) + horaMapa];
      return esNumero(v) ? v : null;
    }
    const d = datos[c.n];
    const v = d ? d[capa().campo] : null;
    return esNumero(v) ? v : null;
  }
  const colorValor = v => v === null ? '#64748b' : capa().color(v);
  const filtroActivo = () => !!(consulta || depFiltro);
  const coincide = c => (!depFiltro || c.dep === depFiltro) && (!consulta || c.n.toLowerCase().includes(consulta));

  // ============ 5) PEDIR DATOS A LA API ============
  class ErrorApi extends Error { constructor(tipo) { super(tipo); this.tipo = tipo; } }

  // fetch con tiempo máximo y un reintento si falla la red
  async function pedir(url, ms = 12000, reintentos = 1) {
    for (let i = 0; i <= reintentos; i++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const resp = await fetch(url, { signal: ctl.signal });
        clearTimeout(t);
        if (resp.status === 429) throw new ErrorApi('limite');
        if (!resp.ok) throw new ErrorApi('http' + resp.status);
        return await resp.json();
      } catch (e) {
        clearTimeout(t);
        if (i === reintentos || (e && e.tipo === 'limite')) throw e;
        await esperar(800 * (i + 1));
      }
    }
  }

  // El clima actual de TODAS las ciudades se pide en lotes de 40 (en paralelo)
  const TAM_LOTE = 40;
  async function cargarTodas() {
    const lotes = [];
    for (let i = 0; i < CIUDADES.length; i += TAM_LOTE) lotes.push(CIUDADES.slice(i, i + TAM_LOTE));
    const res = await Promise.allSettled(lotes.map(async lote => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lote.map(c => c.lat).join(',')}` +
        `&longitude=${lote.map(c => c.lon).join(',')}` +
        `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,is_day&timezone=America%2FAsuncion`;
      const json = await pedir(url);
      const lista = Array.isArray(json) ? json : [json];
      lista.forEach((d, i) => { if (d && d.current && lote[i]) datos[lote[i].n] = d.current; });
    }));
    const ok = res.filter(r => r.status === 'fulfilled').length;
    if (!ok) throw res[0].reason;
    return { ok, total: lotes.length };
  }

  // El detalle (humedad, viento, horas, días) se pide solo de la ciudad elegida
  async function cargarDetalle(c) {
    const guardado = cacheDetalle.get(c.n);
    if (guardado && Date.now() - guardado.t < 5 * 60 * 1000) return guardado.d;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure` +
      `&hourly=temperature_2m,precipitation_probability,weather_code,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset` +
      `&timezone=America%2FAsuncion&forecast_days=6`;
    let d;
    try { d = await pedir(url); }
    catch (e) { const v = leerJSON('clima-py-det-' + c.n, null); if (v) return v; throw e; }   // sin internet: último detalle guardado
    if (d && d.current && d.hourly && d.daily) guardar('clima-py-det-' + c.n, JSON.stringify(d));
    if (!d || !d.current || !d.hourly || !d.daily) throw new ErrorApi('datos');
    cacheDetalle.set(c.n, { t: Date.now(), d });
    return d;
  }

  // ============ 6) MAPA ============
  const svg = $('mapa');
  // Proyección: convierte longitud/latitud en posición X/Y del dibujo.
  // La longitud se multiplica por cos(24.5°) para que el país no se vea "estirado".
  const COS = Math.cos(24.5 * Math.PI / 180);
  const K = 62;       // unidades del dibujo por cada grado de latitud
  const PAD = 0.45;   // margen en grados alrededor del país
  const todosPts = GEO.deps.flatMap(d => d.r.flat());
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  todosPts.forEach(p => { lonMin = Math.min(lonMin, p[0]); lonMax = Math.max(lonMax, p[0]); latMin = Math.min(latMin, p[1]); latMax = Math.max(latMax, p[1]); });
  const px = lon => (lon - lonMin + PAD) * COS * K;
  const py = lat => (latMax + PAD - lat) * K;
  const W = (lonMax - lonMin + 2 * PAD) * COS * K;
  const H = (latMax - latMin + 2 * PAD) * K;
  const ZOOM_MAX = 12;

  // Convierte un anillo de coordenadas en el texto "M x y L x y ... Z" que entiende SVG
  const trazo = anillo => 'M' + anillo.map(p => px(p[0]).toFixed(1) + ' ' + py(p[1]).toFixed(1)).join('L') + 'Z';

  // Estas partes del mapa no cambian: se calculan una sola vez
  const trazoVecinos = Object.values(GEO.vecinos).flat().map(trazo);
  const trazoDeps = GEO.deps.map(d => ({ n: d.n, d: d.r.map(trazo).join('') }));
  const trazoDistritos = GEO.dist.map(rs => rs.map(trazo).join('')).join('');
  const ROTULOS = [['ARGENTINA', -60.6, -26.2], ['BRASIL', -54.4, -21.2], ['BOLIVIA', -60.2, -18.95]];

  // Caja y centro de cada departamento (en unidades del dibujo), para ajustar el zoom y poner su nombre
  const infoDep = {};
  GEO.deps.forEach(d => {
    const anillo = d.r.reduce((a, b) => b.length > a.length ? b : a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0, cx = 0, cy = 0;
    d.r.flat().forEach(p => { x0 = Math.min(x0, px(p[0])); x1 = Math.max(x1, px(p[0])); y0 = Math.min(y0, py(p[1])); y1 = Math.max(y1, py(p[1])); });
    for (let i = 0; i < anillo.length - 1; i++) {
      const ax = px(anillo[i][0]), ay = py(anillo[i][1]), bx = px(anillo[i + 1][0]), by = py(anillo[i + 1][1]);
      const cruz = ax * by - bx * ay;
      area += cruz; cx += (ax + bx) * cruz; cy += (ay + by) * cruz;
    }
    area *= 0.5;
    infoDep[d.n] = { x0, x1, y0, y1, cx: area ? cx / (6 * area) : (x0 + x1) / 2, cy: area ? cy / (6 * area) : (y0 + y1) / 2 };
  });

  let vista = { x: 0, y: 0, w: W, h: H };   // la parte del mapa que se ve (zoom y movimiento)
  const nivelZoom = () => W / vista.w;
  let animId = 0;

  function aplicarVista() {
    vista.w = limitar(vista.w, W / ZOOM_MAX, W);
    vista.h = vista.w * H / W;
    vista.x = limitar(vista.x, 0, W - vista.w);
    vista.y = limitar(vista.y, 0, H - vista.h);
    svg.setAttribute('viewBox', `${vista.x.toFixed(2)} ${vista.y.toFixed(2)} ${vista.w.toFixed(2)} ${vista.h.toFixed(2)}`);
    const z = nivelZoom();
    // Los distritos van apareciendo al acercar
    const gd = $('gDist');
    if (gd) gd.style.opacity = limitar((z - 1.8) / 1.2, 0, 1).toFixed(2);
    // Con el mapa completo, un dedo puede deslizar la página; con zoom, mueve el mapa
    svg.style.touchAction = z > 1.05 ? 'none' : 'pan-y';
    programarPuntos();
  }
  function zoomEn(factor, cx, cy) {
    animId++;
    const nw = limitar(vista.w / factor, W / ZOOM_MAX, W);
    const f = nw / vista.w;
    vista.x = cx - (cx - vista.x) * f;
    vista.y = cy - (cy - vista.y) * f;
    vista.w = nw;
    aplicarVista();
  }
  // Mueve la vista con una animación suave hasta "dest" ({x, y, w})
  function irA(dest, ms = 380) {
    const id = ++animId;
    if (REDUCIDO || ms === 0) { vista.x = dest.x; vista.y = dest.y; vista.w = dest.w; aplicarVista(); return; }
    const ini = { x: vista.x, y: vista.y, w: vista.w }, t0 = performance.now();
    (function paso(t) {
      if (id !== animId) return;
      const k = limitar((t - t0) / ms, 0, 1), e = 1 - Math.pow(1 - k, 3);
      vista.x = ini.x + (dest.x - ini.x) * e;
      vista.y = ini.y + (dest.y - ini.y) * e;
      vista.w = ini.w + (dest.w - ini.w) * e;
      aplicarVista();
      if (k < 1) requestAnimationFrame(paso);
    })(t0);
  }
  function clienteASvg(ev) {
    const r = svg.getBoundingClientRect();
    return { x: vista.x + (ev.clientX - r.left) / r.width * vista.w, y: vista.y + (ev.clientY - r.top) / r.height * vista.h };
  }
  function centrarEn(c, zoomMin) {
    const w = Math.min(vista.w, W / Math.max(zoomMin || 1, nivelZoom()));
    const h = w * H / W;
    if (nivelZoom() <= 1.05 && !zoomMin) return;
    irA({ x: px(c.lon) - w / 2, y: py(c.lat) - h / 2, w });
  }
  function ajustarA(b) {
    const w = limitar(Math.max((b.x1 - b.x0) * 1.35, (b.y1 - b.y0) * 1.35 * W / H), W / ZOOM_MAX, W);
    irA({ x: (b.x0 + b.x1) / 2 - w / 2, y: (b.y0 + b.y1) / 2 - w * H / W / 2, w });
  }

  // Promedio de la capa actual en cada departamento (para colorearlo)
  function promedioDep(nombre) {
    const vs = CIUDADES.filter(c => c.dep === nombre).map(valor).filter(v => v !== null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  }
  const colorDep = n => { const p = promedioDep(n); return p === null ? 'rgba(92,200,255,0.18)' : capa().color(p); };

  // Dibuja las capas fijas del mapa (vecinos, contorno, departamentos, distritos)
  function dibujarMapaBase() {
    const caminos = trazoDeps.map(dp => dp.d);
    let h = '<g>' + trazoVecinos.map(d => `<path class="vecino" d="${d}"/>`).join('') + '</g>';
    h += '<g>' + ROTULOS.map(([t, lo, la]) =>
      `<text class="rotulo-pais" x="${px(lo).toFixed(1)}" y="${py(la).toFixed(1)}" text-anchor="middle" font-size="11">${t}</text>`).join('') + '</g>';
    // Truco del contorno: un trazo grueso debajo y los departamentos tapándolo; solo se ve el borde exterior
    h += '<g>' + caminos.map(d => `<path class="contorno" d="${d}"/>`).join('') + '</g>';
    h += '<g>' + caminos.map(d => `<path class="base" d="${d}"/>`).join('') + '</g>';
    h += '<g id="gDeps">' + trazoDeps.map(dp =>
      `<path class="dep" data-dep="${dp.n}" d="${dp.d}" style="fill:${colorDep(dp.n)}"/>`).join('') + '</g>';
    h += `<g id="gDist" style="opacity:0"><path class="distritos" d="${trazoDistritos}"/></g>`;
    h += '<g id="gNomDep"></g><g id="gPuntos"></g>';
    svg.innerHTML = h;
    aplicarVista();
  }

  // Vuelve a colorear los departamentos (cuando llegan datos nuevos o cambia la capa o el filtro)
  function pintarDeps() {
    svg.querySelectorAll('.dep').forEach(el => {
      el.style.fill = colorDep(el.dataset.dep);
      el.classList.toggle('filtrado', el.dataset.dep === depFiltro);
    });
  }

  // Medir texto con un canvas (para saber cuánto ocupa cada etiqueta y evitar que se pisen)
  const ctxTexto = document.createElement('canvas').getContext('2d');
  ctxTexto.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const cacheAncho = new Map();
  function anchoTexto(t) {
    let w = cacheAncho.get(t);
    if (w === undefined) { w = ctxTexto.measureText(t).width; cacheAncho.set(t, w); }
    return w;
  }

  let pendiente = false;
  function programarPuntos() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; dibujarPuntos(); });
  }

  // Dibuja puntos y etiquetas. Con el mapa completo solo se ven las ciudades más grandes;
  // al acercar aparecen las demás. Las etiquetas nunca se pisan ni se salen del mapa.
  function dibujarPuntos() {
    const g = $('gPuntos');
    if (!g) return;
    const z = nivelZoom();
    const rect = svg.getBoundingClientRect();
    const ancho = rect.width || 600, alto = rect.height || ancho * H / W;
    const esc = ancho / vista.w;                  // píxeles de pantalla por unidad del dibujo
    const rpx = 4.6 + (z - 1) * 0.5;              // radio del punto en píxeles (crece un poco al acercar)
    const maxGrado = z < 1.7 ? 2 : 3;
    const filtrando = filtroActivo();
    const enfoque = c => c.n === seleccionada || c.n === hover;

    // 1) ¿Qué puntos se ven?
    const vis = [];
    for (const c of CIUDADES) {
      if (!enfoque(c)) { if (filtrando ? !coincide(c) : c.g > maxGrado) continue; }
      const sx = (px(c.lon) - vista.x) * esc, sy = (py(c.lat) - vista.y) * esc;
      if (sx < -20 || sx > ancho + 20 || sy < -20 || sy > alto + 20) continue;
      vis.push({ c, sx, sy, sel: c.n === seleccionada });
    }
    vis.sort((a, b) => (a.sel - b.sel));          // la elegida se dibuja encima de las demás
    const u = v => (v / esc).toFixed(2);          // de píxeles a unidades del dibujo
    const X = v => (vista.x + v / esc).toFixed(1), Y = v => (vista.y + v / esc).toFixed(1);

    let pts = '';
    vis.forEach(({ c, sx, sy, sel }) => {
      const v = valor(c);
      pts += `<circle class="punto${sel ? ' sel' : ''}" cx="${X(sx)}" cy="${Y(sy)}" r="${u(sel ? rpx * 1.35 : rpx)}" fill="${colorValor(v)}"/>`;
      if (c.n === hover && !sel) pts += `<circle class="anillo" cx="${X(sx)}" cy="${Y(sy)}" r="${u(rpx + 5)}"/>`;
      pts += `<circle class="zona" data-ciudad="${c.n}" cx="${X(sx)}" cy="${Y(sy)}" r="${u(Math.max(rpx + 3, 11))}"/>`;
    });

    // 2) Etiquetas: se prueban por prioridad y solo se dibuja la que cabe sin pisar nada
    const fpx = 12, colocadas = [];
    const puntosRect = vis.map(it => ({ it, x: it.sx - rpx - 1, y: it.sy - rpx - 1, w: 2 * rpx + 2, h: 2 * rpx + 2 }));
    const prioridad = it => it.sel ? 0 : it.c.n === hover ? 1 : it.c.g;
    const quiere = it => it.sel || it.c.n === hover || filtrando || it.c.g === 1 || (it.c.g === 2 && z >= 2) || z >= 4.5;
    const choca = (r, it) => {
      if (r.x < 3 || r.y < 3 || r.x + r.w > ancho - 3 || r.y + r.h > alto - 3) return true;
      for (const o of colocadas) if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) return true;
      for (const p of puntosRect) if (p.it !== it && r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h) return true;
      return false;
    };
    let txt = '';
    vis.filter(quiere).sort((a, b) => prioridad(a) - prioridad(b) || a.sy - b.sy).forEach(it => {
      const v = valor(it.c);
      const texto = v === null ? it.c.n : `${it.c.n} ${fmt(v)}`;
      const w = anchoTexto(texto) + 4, h = fpx + 2;
      const derPrimero = it.sx < ancho * 0.55;
      const opciones = [
        { x: it.sx + rpx + 4, y: it.sy - h / 2, a: 'start', ax: it.sx + rpx + 4 + 2 },
        { x: it.sx - rpx - 4 - w, y: it.sy - h / 2, a: 'end', ax: it.sx - rpx - 4 - 2 },
        { x: it.sx - w / 2, y: it.sy - rpx - 3 - h, a: 'middle', ax: it.sx },
        { x: it.sx - w / 2, y: it.sy + rpx + 3, a: 'middle', ax: it.sx }
      ];
      if (!derPrimero) [opciones[0], opciones[1]] = [opciones[1], opciones[0]];
      let elegida = opciones.find(o => !choca({ x: o.x, y: o.y, w, h }, it.c));
      if (!elegida && it.sel) {           // la ciudad elegida siempre muestra su nombre
        elegida = opciones[0];
        elegida = { ...elegida, x: limitar(elegida.x, 3, ancho - w - 3), y: limitar(elegida.y, 3, alto - h - 3) };
        elegida.ax = elegida.a === 'end' ? elegida.x + w - 2 : elegida.a === 'middle' ? elegida.x + w / 2 : elegida.x + 2;
      }
      if (!elegida) return;
      colocadas.push({ x: elegida.x, y: elegida.y, w, h });
      txt += `<text class="etiqueta${it.sel ? ' sel' : ''}" x="${X(elegida.ax)}" y="${Y(elegida.y + h / 2 + fpx * 0.35)}" font-size="${u(fpx)}" stroke-width="${u(3)}" text-anchor="${elegida.a}">${texto}</text>`;
    });
    g.innerHTML = pts + txt;

    // 3) Nombres de los departamentos: van al final y solo si caben dentro de su área
    //    sin pisar ninguna ciudad, ningún punto ni otro nombre
    let nd = '';
    if (z < 3.2) {
      const cand = GEO.deps.filter(d => d.n !== 'Asunción').map(d => {
        const i = infoDep[d.n], nombre = d.n.toUpperCase();
        return {
          nombre, w: anchoTexto(nombre) * 10 / 12 + nombre.length * 1.3 + 4, h: 13,
          sx: (i.cx - vista.x) * esc, sy: (i.cy - vista.y) * esc, ancho: (i.x1 - i.x0) * esc
        };
      }).filter(o => o.w < o.ancho * 0.8).sort((a, b) => b.ancho - a.ancho);
      cand.forEach(o => {
        const r = { x: o.sx - o.w / 2, y: o.sy - o.h / 2, w: o.w, h: o.h };
        if (choca(r, null)) return;           // choca() también descarta lo que se sale del mapa
        colocadas.push(r);
        nd += `<text class="nom-dep" x="${X(o.sx)}" y="${Y(o.sy + 3.5)}" font-size="${u(10)}">${o.nombre}</text>`;
      });
    }
    $('gNomDep').innerHTML = nd;
  }

  // --- Interacción con el mapa: zoom, arrastrar, pellizcar, clic, teclado y tooltip ---
  const punteros = new Map();
  let inicioClic = null, seMovio = false, distPinza = 0, temporizadorPista = 0;
  const tip = $('tooltip');
  const ocultarTip = () => { tip.style.display = 'none'; };

  // La rueda sola NO hace zoom (así no te bloquea el scroll de la página); con Ctrl sí
  svg.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const p = clienteASvg(e);
      zoomEn(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), p.x, p.y);
    } else {
      $('pista').classList.add('on');
      clearTimeout(temporizadorPista);
      temporizadorPista = setTimeout(() => $('pista').classList.remove('on'), 1300);
    }
  }, { passive: false });

  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    animId++;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 1) { inicioClic = { x: e.clientX, y: e.clientY }; seMovio = false; }
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      distPinza = Math.hypot(a.x - b.x, a.y - b.y);
      seMovio = true;
    }
  });
  window.addEventListener('pointermove', e => {
    if (!punteros.has(e.pointerId)) return;
    const previo = punteros.get(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    if (punteros.size === 1 && inicioClic) {
      if (!seMovio && Math.hypot(e.clientX - inicioClic.x, e.clientY - inicioClic.y) > 5) {
        seMovio = true; svg.classList.add('arrastrando'); ocultarTip();
      }
      if (seMovio) {
        vista.x -= (e.clientX - previo.x) / r.width * vista.w;
        vista.y -= (e.clientY - previo.y) / r.height * vista.h;
        aplicarVista();
      }
    } else if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (distPinza > 0) {
        const centro = clienteASvg({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        zoomEn(dist / distPinza, centro.x, centro.y);
      }
      distPinza = dist;
    }
  });
  function soltar(e) {
    if (!punteros.has(e.pointerId)) return;
    const eraClic = punteros.size === 1 && !seMovio && e.type === 'pointerup';
    punteros.delete(e.pointerId);
    svg.classList.remove('arrastrando');
    if (punteros.size < 2) distPinza = 0;
    if (eraClic && e.target && e.target.closest) {
      const ciudad = e.target.closest('[data-ciudad]');
      const dep = e.target.closest('[data-dep]');
      if (ciudad) elegir(ciudad.dataset.ciudad, { desdeMapa: true });
      else if (dep) filtrarDep(dep.dataset.dep === depFiltro ? '' : dep.dataset.dep);
    }
  }
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);

  // Teclado: + / - para el zoom, 0 para ver todo, flechas para moverse
  svg.addEventListener('keydown', e => {
    const cx = vista.x + vista.w / 2, cy = vista.y + vista.h / 2;
    let usado = true;
    if (e.key === '+' || e.key === '=') zoomEn(1.4, cx, cy);
    else if (e.key === '-' || e.key === '_') zoomEn(1 / 1.4, cx, cy);
    else if (e.key === '0') irA({ x: 0, y: 0, w: W });
    else if (e.key === 'ArrowLeft') { animId++; vista.x -= vista.w * 0.15; aplicarVista(); }
    else if (e.key === 'ArrowRight') { animId++; vista.x += vista.w * 0.15; aplicarVista(); }
    else if (e.key === 'ArrowUp') { animId++; vista.y -= vista.h * 0.15; aplicarVista(); }
    else if (e.key === 'ArrowDown') { animId++; vista.y += vista.h * 0.15; aplicarVista(); }
    else usado = false;
    if (usado) e.preventDefault();
  });

  // Tooltip (el globito que aparece al pasar el mouse)
  svg.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    const ciudad = e.target.closest('[data-ciudad]');
    const dep = e.target.closest('[data-dep]');
    let html = '';
    if (ciudad) {
      const c = porNombre.get(ciudad.dataset.ciudad), d = datos[c.n];
      const w = d ? clima(d.weather_code, d.is_day).emoji + ' ' : '';
      html = `<b>${c.n}</b> · ${nombreDep(c.dep)}<br>${w}${d ? grados(d.temperature_2m) + UT() : 'sin datos'}`;
      if (capaId !== 'temp' && valor(c) !== null) html += ` · ${capa().nombre.toLowerCase()} ${fmt(valor(c), true)}`;
    } else if (dep) {
      const p = promedioDep(dep.dataset.dep);
      const n = CIUDADES.filter(c => c.dep === dep.dataset.dep).length;
      html = `<b>${nombreDep(dep.dataset.dep)}</b><br>${p === null ? 'Sin datos' : 'Promedio ' + fmt(p, true)} · ${n} ciudad${n === 1 ? '' : 'es'}`;
    }
    if (!html) { ocultarTip(); return; }
    const caja = $('mapaCont').getBoundingClientRect();
    tip.innerHTML = html;
    tip.style.display = 'block';
    let x = e.clientX - caja.left + 14, y = e.clientY - caja.top + 14;
    if (x + tip.offsetWidth > caja.width - 4) x = e.clientX - caja.left - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > caja.height - 4) y = e.clientY - caja.top - tip.offsetHeight - 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  });
  svg.addEventListener('pointerleave', ocultarTip);

  $('zMas').addEventListener('click', () => zoomEn(1.6, vista.x + vista.w / 2, vista.y + vista.h / 2));
  $('zMenos').addEventListener('click', () => zoomEn(1 / 1.6, vista.x + vista.w / 2, vista.y + vista.h / 2));
  $('zReset').addEventListener('click', () => irA({ x: 0, y: 0, w: W }));

  // Cartelito sobre el mapa con la ciudad elegida
  function pintarChip() {
    const c = porNombre.get(seleccionada), d = datos[c.n];
    $('chipSel').textContent = d ? `${clima(d.weather_code, d.is_day).emoji} ${c.n} · ${grados(d.temperature_2m)}` : c.n;
  }

  // Capas del mapa (botones) y leyenda de colores
  function pintarCapas() {
    $('capas').innerHTML = Object.entries(CAPAS).map(([id, c]) =>
      `<button class="capa${id === capaId ? ' on' : ''}" role="tab" aria-selected="${id === capaId}" data-capa="${id}">${c.icono} ${c.nombre}</button>`).join('');
    const c = capa(), paradas = [];
    for (let i = 0; i <= 6; i++) paradas.push(c.color(c.min + (c.max - c.min) * i / 6));
    $('grad').style.background = `linear-gradient(90deg, ${paradas.join(',')})`;
    $('legIni').textContent = fmt(c.min, true);
    $('legFin').textContent = fmt(c.max, true) + (capaId === 'lluvia' || capaId === 'viento' || capaId === 'humedad' ? '+' : '');
  }
  $('capas').addEventListener('click', e => {
    const b = e.target.closest('[data-capa]');
    if (!b || b.dataset.capa === capaId) return;
    capaId = b.dataset.capa;
    escribirHash();
    pintarCapas();
    refrescarVistas();
  });

  // ============ 6b) DESLIZADOR DE TIEMPO ============
  async function cargarHoras() {
    const lotes = [];
    for (let i = 0; i < CIUDADES.length; i += TAM_LOTE) lotes.push(CIUDADES.slice(i, i + TAM_LOTE));
    const nuevas = {};
    await Promise.allSettled(lotes.map(async lote => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lote.map(c => c.lat).join(',')}` +
        `&longitude=${lote.map(c => c.lon).join(',')}` +
        `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&timezone=America%2FAsuncion&forecast_days=2`;
      const json = await pedir(url);
      (Array.isArray(json) ? json : [json]).forEach((d, i) => { if (d && d.hourly && lote[i]) nuevas[lote[i].n] = d.hourly; });
    }));
    if (!Object.keys(nuevas).length) throw new ErrorApi('datos');
    horas = nuevas; horasT = Date.now();
  }
  function asegurarHoras() {
    if (horas && Date.now() - horasT < 30 * 60 * 1000) return Promise.resolve(true);
    if (!pHoras) pHoras = cargarHoras().then(() => true).catch(() => { aviso('No se pudo cargar el pronóstico por horas.'); return false; }).finally(() => { pHoras = null; });
    return pHoras;
  }
  // posición de "esta hora" dentro de los datos por hora de una ciudad
  function indiceAhora(n) {
    const ref = datos[n] && datos[n].time ? datos[n].time.slice(0, 13) : '';
    const i = horas[n].time.findIndex(t => t.slice(0, 13) === ref);
    return i < 0 ? new Date().getHours() : i;
  }
  function etiquetaHora() {
    if (!horaMapa || !horas) return 'Ahora';
    const n = Object.keys(horas)[0], f = new Date(horas[n].time[indiceAhora(n) + horaMapa]);
    return `${f.toLocaleDateString('es', { weekday: 'short' })} ${String(f.getHours()).padStart(2, '0')}:00 · en ${horaMapa} h`;
  }
  function irAHora(h) {
    horaMapa = h;
    $('hSlider').value = h;
    $('hEtq').textContent = etiquetaHora();
    refrescarVistas();
  }
  let relojMapa = null;
  function pararReloj() { clearInterval(relojMapa); relojMapa = null; $('hPlay').textContent = '▶'; $('hPlay').setAttribute('aria-label', 'Reproducir'); }
  $('hSlider').addEventListener('input', async e => {
    pararReloj();
    if (+e.target.value > 0) {
      $('hEtq').textContent = 'Cargando…';
      if (!(await asegurarHoras())) { irAHora(0); return; }
    }
    irAHora(+e.target.value);
  });
  $('hPlay').addEventListener('click', async () => {
    if (relojMapa) { pararReloj(); return; }
    $('hPlay').textContent = '⏸'; $('hPlay').setAttribute('aria-label', 'Pausar');
    $('hEtq').textContent = 'Cargando…';
    if (!(await asegurarHoras())) { irAHora(0); pararReloj(); return; }
    if (horaMapa >= 24) irAHora(0);
    relojMapa = setInterval(() => { if (horaMapa >= 24 || document.hidden) pararReloj(); else irAHora(horaMapa + 1); }, 700);
  });

  // ============ 6c) COMPARAR CIUDADES ============
  const NOMBRES = CIUDADES.map(c => c.n).sort((a, b) => a.localeCompare(b, 'es'));
  const COLORES_COMP = ['#fbbf24', '#38bdf8', '#f472b6'];
  let compSel = leerJSON('clima-py-comp', ['Asunción', 'Encarnación', 'Ciudad del Este']).filter(n => porNombre.has(n));
  if (compSel.length < 2) compSel = ['Asunción', 'Encarnación', 'Ciudad del Este'];
  let tokenComp = 0;
  function pintarSelectsComp() {
    $('compSel').innerHTML = [0, 1, 2].map(i =>
      `<select data-i="${i}" aria-label="Ciudad ${i + 1}" style="border-left:4px solid ${COLORES_COMP[i]}">` +
      (i === 2 ? `<option value="">— ninguna —</option>` : '') +
      NOMBRES.map(n => `<option${n === compSel[i] ? ' selected' : ''}>${n}</option>`).join('') + `</select>`).join('');
  }
  function graficoComp(items) {
    const W = 600, H = 190, X0 = 34, X1 = W - 10, Y0 = 14, Y1 = H - 26;
    const series = items.filter(x => x.d).map(x => {
      const d = x.d, i0 = Math.max(0, d.hourly.time.findIndex(t => t.slice(0, 13) === d.current.time.slice(0, 13)));
      return { col: x.col, v: d.hourly.temperature_2m.slice(i0, i0 + 25), t: d.hourly.time.slice(i0, i0 + 25) };
    });
    const todos = series.flatMap(s => s.v).filter(esNumero);
    if (!todos.length) return '';
    const lo = Math.floor(Math.min(...todos)) - 1, hi = Math.ceil(Math.max(...todos)) + 1;
    const px = i => X0 + (X1 - X0) * i / 24, py = v => Y1 - (Y1 - Y0) * (v - lo) / (hi - lo);
    const lineas = series.map(s => `<polyline fill="none" stroke="${s.col}" stroke-width="2.5" stroke-linejoin="round" points="${s.v.map((v, i) => esNumero(v) ? px(i).toFixed(1) + ',' + py(v).toFixed(1) : '').filter(Boolean).join(' ')}"/>`).join('');
    const ejeY = [lo, (lo + hi) / 2, hi].map(v => `<text x="${X0 - 5}" y="${py(v) + 4}" text-anchor="end">${Math.round(aU(v))}°</text><line x1="${X0}" x2="${X1}" y1="${py(v)}" y2="${py(v)}" stroke="currentColor" opacity=".15"/>`).join('');
    const ejeX = [0, 6, 12, 18, 24].map(i => `<text x="${px(i)}" y="${H - 8}" text-anchor="middle">${series[0].t[i] ? series[0].t[i].slice(11, 16) : ''}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="comp-graf" role="img" aria-label="Temperatura de las próximas 24 horas">${ejeY}${ejeX}${lineas}</svg>`;
  }
  async function pintarComparacion() {
    const mi = ++tokenComp, nombres = [...new Set(compSel.filter(Boolean))];
    $('compRes').innerHTML = '<div class="vacio">Cargando…</div>';
    const res = await Promise.allSettled(nombres.map(n => cargarDetalle(porNombre.get(n))));
    if (mi !== tokenComp) return;
    const items = nombres.map((n, i) => ({ c: porNombre.get(n), d: res[i].status === 'fulfilled' ? res[i].value : null, col: COLORES_COMP[compSel.indexOf(n)] }));
    const fila = (titulo, f) => `<tr><th scope="row">${titulo}</th>${items.map(x => `<td>${x.d ? f(x.d) : '--'}</td>`).join('')}</tr>`;
    const num = (v, u) => esNumero(v) ? Math.round(v) + u : '--';
    $('compRes').innerHTML = `${graficoComp(items)}
      <div class="comp-tabla"><table>
        <thead><tr><th></th>${items.map(x => `<th scope="col"><span class="comp-punto" style="background:${x.col}"></span>${x.c.n}</th>`).join('')}</tr></thead>
        <tbody>
          ${fila('Ahora', d => { const w = clima(d.current.weather_code, d.current.is_day); return `${w.emoji} ${w.texto}`; })}
          ${fila('Temperatura', d => `<b>${grados(d.current.temperature_2m) + UT()}</b>`)}
          ${fila('Sensación', d => grados(d.current.apparent_temperature) + UT())}
          ${fila('Máx. / mín. hoy', d => `${grados(d.daily.temperature_2m_max[0])} / ${grados(d.daily.temperature_2m_min[0])}`)}
          ${fila('Humedad', d => num(d.current.relative_humidity_2m, '%'))}
          ${fila('Viento', d => `${num(d.current.wind_speed_10m, ' km/h')} ${dirViento(d.current.wind_direction_10m)}`)}
          ${fila('Prob. de lluvia hoy', d => num(d.daily.precipitation_probability_max[0], '%'))}
          ${fila('Índice UV (máx. hoy)', d => num(d.daily.uv_index_max[0], ''))}
          ${fila('Presión', d => num(d.current.surface_pressure, ' hPa'))}
          ${fila('Mañana', d => { const w = clima(d.daily.weather_code[1], 1); return `${w.emoji} ${grados(d.daily.temperature_2m_max[1])} / ${grados(d.daily.temperature_2m_min[1])}`; })}
        </tbody></table></div>
      ${items.some(x => !x.d) ? '<p class="ayuda">No se pudo cargar alguna ciudad. Prueba de nuevo en un momento.</p>' : ''}`;
  }
  $('btnComparar').addEventListener('click', () => {
    const p = $('comparar');
    if (!p.hidden) { p.hidden = true; return; }
    p.hidden = false; pintarSelectsComp(); pintarComparacion();
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('compCerrar').addEventListener('click', () => { $('comparar').hidden = true; });
  $('compSel').addEventListener('change', e => {
    compSel[+e.target.dataset.i] = e.target.value;
    compSel = compSel.slice(0, 3);
    guardar('clima-py-comp', JSON.stringify(compSel.filter(Boolean)));
    pintarComparacion();
  });

  // ============ 6d) RADAR, RUTAS, LUGARES, TEMA Y UNIDAD ============
  const SVGNS = 'http://www.w3.org/2000/svg';
  function capaSvg(id, antesDe) {
    let g = $(id);
    if (!g) { g = document.createElementNS(SVGNS, 'g'); g.id = id; g.setAttribute('pointer-events', 'none'); svg.insertBefore(g, $(antesDe)); }
    return g;
  }
  // Radar de lluvia (RainViewer): últimas imágenes de radar sobre el mapa, en bucle
  let radarOn = false, radarIdx = 0, radarTimer = null, radarFrames = [];
  function mostrarFrameRadar() {
    document.querySelectorAll('#gRadar .rf').forEach(im => { im.style.opacity = +im.dataset.f === radarIdx ? '1' : '0'; });
    const min = Math.max(0, Math.round((Date.now() / 1000 - radarFrames[radarIdx].time) / 60));
    $('radarEtq').textContent = min < 2 ? 'Radar · ahora' : `Radar · hace ${min} min`;
  }
  function pararRadar() { clearInterval(radarTimer); radarTimer = null; radarOn = false; if ($('gRadar')) $('gRadar').innerHTML = ''; $('radarEtq').textContent = ''; $('btnRadar').classList.remove('on'); }
  async function alternarRadar() {
    if (radarOn) { pararRadar(); return; }
    radarOn = true; $('btnRadar').classList.add('on'); $('radarEtq').textContent = 'Cargando radar…';
    try {
      const j = await pedir('https://api.rainviewer.com/public/weather-maps.json');
      radarFrames = ((j.radar && j.radar.past) || []).slice(-7);
      if (!radarFrames.length) throw new ErrorApi('datos');
      const Z = 6, N = 2 ** Z;
      const tx = lon => Math.floor((lon + 180) / 360 * N);
      const ty = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N); };
      const lonT = x => x / N * 360 - 180, latT = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / N))) * 180 / Math.PI;
      const x0 = tx(lonMin - PAD), x1 = tx(lonMax + PAD), y0 = ty(latMax + PAD), y1 = ty(latMin - PAD);
      let h = '';
      radarFrames.forEach((f, i) => {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const L = px(lonT(x)), R = px(lonT(x + 1)), T = py(latT(y)), B = py(latT(y + 1));
          h += `<image class="rf" data-f="${i}" href="${j.host}${f.path}/256/${Z}/${x}/${y}/2/1_1.png" x="${L.toFixed(2)}" y="${T.toFixed(2)}" width="${(R - L).toFixed(2)}" height="${(B - T).toFixed(2)}" preserveAspectRatio="none" style="opacity:0"/>`;
        }
      });
      const g = capaSvg('gRadar', 'gDist'); g.style.opacity = '0.8'; g.innerHTML = h;
      radarIdx = radarFrames.length - 1; mostrarFrameRadar();
      radarTimer = setInterval(() => { if (document.hidden) return; radarIdx = (radarIdx + 1) % radarFrames.length; mostrarFrameRadar(); }, 700);
    } catch (e) { pararRadar(); aviso('No se pudo cargar el radar.'); }
  }
  $('btnRadar').addEventListener('click', alternarRadar);

  // Rutas principales (aproximadas: líneas rectas entre ciudades de cada ruta)
  const RUTAS = { 'Ruta 1': ['Asunción', 'Carapeguá', 'Quiindy', 'San Juan Bautista', 'San Ignacio', 'Coronel Bogado', 'Encarnación'],
    'Ruta 2': ['Asunción', 'San Lorenzo', 'Ypacaraí', 'Caacupé', 'Coronel Oviedo'], 'Ruta 7': ['Coronel Oviedo', 'Caaguazú', 'Ciudad del Este'],
    'Ruta 9': ['Asunción', 'Villa Hayes', 'Filadelfia'], 'Ruta 5': ['Concepción', 'Horqueta', 'Pedro Juan Caballero'], 'Ruta 6': ['Encarnación', 'Hohenau', 'Ciudad del Este'] };
  let rutasOn = false;
  $('btnRutas').addEventListener('click', () => {
    rutasOn = !rutasOn; $('btnRutas').classList.toggle('on', rutasOn);
    const g = capaSvg('gRutas', 'gNomDep');
    g.innerHTML = !rutasOn ? '' : Object.values(RUTAS).map(r => {
      const pts = r.map(n => porNombre.get(n)).filter(Boolean);
      return pts.length < 2 ? '' : `<path d="M${pts.map(c => px(c.lon).toFixed(1) + ' ' + py(c.lat).toFixed(1)).join(' L')}" fill="none" stroke="#fde68a" stroke-width="1.8" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" opacity="0.9"/>`;
    }).join('');
  });

  // Buscar cualquier lugar de Paraguay (geocodificador de Open-Meteo)
  async function buscarLugar() {
    const q = $('buscador').value.trim(), caja = $('lugares');
    if (q.length < 3) { aviso('Escribe al menos 3 letras del lugar.'); return; }
    caja.hidden = false; caja.innerHTML = '<span class="ayuda">Buscando…</span>';
    try {
      const j = await pedir(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=es&countryCode=PY`, 12000, 0);
      const r = (j && j.results) || [];
      caja.innerHTML = r.length ? r.map((x, i) => `<button class="btn" data-lugar="${i}">${x.name}${x.admin1 ? ' · ' + x.admin1 : ''}</button>`).join('') + '<button class="btn" data-lugar="x">✕</button>'
        : '<span class="ayuda">No encontré ese lugar en Paraguay.</span> <button class="btn" data-lugar="x">✕</button>';
      caja._r = r;
    } catch (e) { caja.innerHTML = '<span class="ayuda">No se pudo buscar. Revisa tu conexión.</span> <button class="btn" data-lugar="x">✕</button>'; }
  }
  $('btnLugar').addEventListener('click', buscarLugar);
  $('lugares').addEventListener('click', e => {
    const b = e.target.closest('[data-lugar]'); if (!b) return;
    const caja = $('lugares');
    if (b.dataset.lugar !== 'x') {
      const x = caja._r[+b.dataset.lugar], n = x.name + (x.admin1 ? ', ' + x.admin1 : '');
      if (!porNombre.has(n)) porNombre.set(n, { n, lat: x.latitude, lon: x.longitude, dep: x.admin1 || '', g: 3, extra: true });
      elegir(n);
    }
    caja.hidden = true;
  });

  // Tema claro/oscuro y °C/°F
  function pintarTema() {
    const claro = leer('clima-py-tema', 'oscuro') === 'claro';
    document.documentElement.dataset.tema = claro ? 'claro' : 'oscuro';
    $('btnTema').textContent = claro ? '🌙' : '☀️';
    $('btnTema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  }
  $('btnTema').addEventListener('click', () => { guardar('clima-py-tema', leer('clima-py-tema', 'oscuro') === 'claro' ? 'oscuro' : 'claro'); pintarTema(); });
  const pintarUnidad = () => { $('btnUnidad').textContent = usaF ? '°F' : '°C'; };
  $('btnUnidad').addEventListener('click', () => {
    usaF = !usaF; guardar('clima-py-f', usaF ? '1' : '0');
    pintarUnidad(); pintarCapas(); refrescarVistas();
    if (detalleActual && detalleActual.c.n === seleccionada) pintarDetalle();
    if (!$('comparar').hidden) pintarComparacion();
  });
  pintarTema(); pintarUnidad();

  // ============ 7) RESUMEN, LISTA Y DETALLE ============
  function dibujarStats() {
    const con = CIUDADES.filter(c => valor(c) !== null);
    if (!con.length) { $('stats').innerHTML = ''; return; }
    const c = capa();
    const alta = con.reduce((a, b) => valor(b) > valor(a) ? b : a);
    const baja = con.reduce((a, b) => valor(b) < valor(a) ? b : a);
    const prom = con.reduce((s, x) => s + valor(x), 0) / con.length;
    const conLluvia = CIUDADES.filter(x => datos[x.n] && datos[x.n].precipitation > 0);
    const secas = CIUDADES.filter(x => datos[x.n] && esNumero(datos[x.n].precipitation) && datos[x.n].precipitation === 0).length;
    const tarjeta = (titulo, v, sub, ir, color) =>
      `<${ir ? 'button' : 'div'} class="stat"${ir ? ` data-ir="${ir}"` : ''}><small>${titulo}</small><b${color ? ` style="color:${color}"` : ''}>${v}</b><span>${sub}</span></${ir ? 'button' : 'div'}>`;
    $('stats').innerHTML =
      tarjeta(`Promedio · ${c.nombre.toLowerCase()}`, c.dec ? prom.toFixed(c.dec) + c.largo : Math.round(prom * 10) / 10 + c.largo, `${con.length} ciudades`, '', colorValor(prom)) +
      tarjeta(c.alto, fmt(valor(alta), true), alta.n, alta.n, colorValor(valor(alta))) +
      (capaId === 'lluvia'
        ? tarjeta('☀️ Sin lluvia ahora', secas, 'ciudades secas', '', '')
        : tarjeta(c.bajo, fmt(valor(baja), true), baja.n, baja.n, colorValor(valor(baja)))) +
      (conLluvia.length ? tarjeta('🌧️ Con lluvia ahora', conLluvia.length, 'ej.: ' + conLluvia[0].n, conLluvia[0].n, '')
                        : tarjeta('🌧️ Con lluvia ahora', 0, 'ninguna ciudad', '', ''));
  }
  $('stats').addEventListener('click', e => {
    const b = e.target.closest('[data-ir]');
    if (b) elegir(b.dataset.ir, { zoom: true });
  });

  function dibujarLista() {
    const orden = $('orden').value;
    const lista = CIUDADES.filter(coincide);
    const v = c => { const x = valor(c); return x === null ? null : x; };
    lista.sort((a, b) => {
      if (orden === 'nombre') return a.n.localeCompare(b.n, 'es');
      const va = v(a), vb = v(b);
      if (va === null && vb === null) return a.n.localeCompare(b.n, 'es');
      if (va === null) return 1;
      if (vb === null) return -1;
      return orden === 'mayor' ? vb - va : va - vb;
    });
    const favs = lista.filter(c => favoritas.has(c.n)), resto = lista.filter(c => !favoritas.has(c.n));
    const fila = c => {
      const d = datos[c.n], x = valor(c), fav = favoritas.has(c.n);
      return `<div class="item${c.n === seleccionada ? ' activo' : ''}" role="listitem">
        <button class="item-main" data-ciudad="${c.n}">
          <span class="nom">${d ? clima(d.weather_code, d.is_day).emoji : '⏳'} ${c.n}<small>${nombreDep(c.dep)}</small></span>
          <span class="t" style="color:${x === null ? 'var(--suave)' : colorValor(x)}">${fmt(x)}</span>
        </button>
        <button class="estrella${fav ? ' on' : ''}" data-fav="${c.n}" aria-label="${fav ? 'Quitar ' + c.n + ' de favoritas' : 'Marcar ' + c.n + ' como favorita'}">${fav ? '★' : '☆'}</button>
      </div>`;
    };
    const cont = $('lista'), scroll = cont.scrollTop;
    $('contador').textContent = `(${lista.length})`;
    cont.innerHTML = lista.length
      ? (favs.length ? '<div class="sep">★ Favoritas</div>' + favs.map(fila).join('') + (resto.length ? '<div class="sep">Todas</div>' : '') : '') + resto.map(fila).join('')
      : '<div class="vacio">No hay ciudades con ese filtro.<br><button class="btn" id="quitarFiltros">Quitar filtros</button></div>';
    cont.scrollTop = scroll;
  }
  $('lista').addEventListener('click', e => {
    if (e.target.id === 'quitarFiltros') { limpiarFiltros(); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) { alternarFav(fav.dataset.fav); return; }
    const it = e.target.closest('[data-ciudad]');
    if (it) elegir(it.dataset.ciudad, { zoom: true });
  });
  // Al pasar el mouse por la lista, la ciudad se marca en el mapa
  $('lista').addEventListener('mouseover', e => {
    const it = e.target.closest('.item-main');
    const n = it ? it.dataset.ciudad : null;
    if (n !== hover) { hover = n; dibujarPuntos(); }
  });
  $('lista').addEventListener('mouseleave', () => { if (hover) { hover = null; dibujarPuntos(); } });
  // Flechas arriba/abajo para recorrer la lista con el teclado
  $('lista').addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...$('lista').querySelectorAll('.item-main')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : limitar(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    items[j].focus();
  });

  function alternarFav(n) {
    if (favoritas.has(n)) favoritas.delete(n); else favoritas.add(n);
    guardar('clima-py-favs', JSON.stringify([...favoritas]));
    dibujarLista();
    const b = document.querySelector('#detalle .estrella');
    if (b && b.dataset.fav === n) { b.classList.toggle('on', favoritas.has(n)); b.textContent = favoritas.has(n) ? '★' : '☆'; }
  }

  // --- Detalle de la ciudad elegida ---
  // La cabecera (nombre, temperatura, datos) se arma igual con datos parciales o completos
  function luna() {
    const P = 29.530588853, e = (((Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % P + P) % P, i = Math.round(e / P * 8) % 8;
    return { e: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][i], ilum: Math.round((1 - Math.cos(2 * Math.PI * e / P)) / 2 * 100),
      t: ['Luna nueva', 'Creciente', 'Cuarto creciente', 'Gibosa creciente', 'Luna llena', 'Gibosa menguante', 'Cuarto menguante', 'Menguante'][i] };
  }
  const cacheAire = new Map();
  async function cargarAire(c) {
    const g = cacheAire.get(c.n);
    if (g && Date.now() - g.t < 15 * 60000) return g.v;
    const j = await pedir(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lon}&current=us_aqi,pm2_5&timezone=America%2FAsuncion`, 12000, 0);
    const v = j && j.current ? { aqi: j.current.us_aqi, pm: j.current.pm2_5 } : null;
    cacheAire.set(c.n, { t: Date.now(), v });
    return v;
  }
  function textoAire(v) {
    if (!v || !esNumero(v.aqi)) return '--';
    const a = v.aqi, [t, e] = a <= 50 ? ['Buena', '🟢'] : a <= 100 ? ['Moderada', '🟡'] : a <= 150 ? ['Dañina para sensibles', '🟠'] : a <= 200 ? ['Dañina', '🔴'] : a <= 300 ? ['Muy dañina', '🟣'] : ['Peligrosa', '🟤'];
    return `${e} ${Math.round(a)} · ${t}`;
  }
  function llenarAire(c) {
    const poner = t => { const el = document.querySelector('#aireDato b'); if (el && seleccionada === c.n) el.textContent = t; };
    const g = cacheAire.get(c.n);
    if (g) poner(textoAire(g.v));
    cargarAire(c).then(v => poner(textoAire(v))).catch(() => poner('--'));
  }
  function htmlCabecera(c, a, d, error) {
    const L = luna();
    const w = a ? clima(a.weather_code, a.is_day) : (error ? { emoji: '⚠️', texto: 'Sin datos por ahora' } : { emoji: '⏳', texto: 'Cargando…' });
    const t = a ? a.temperature_2m : null;
    const fav = favoritas.has(c.n);
    const esq = x => d ? x : '<span class="esq">0000</span>';
    const dato = (titulo, v) => `<div class="dato"><small>${titulo}</small><b>${d ? v : '<span class="esq">0000000</span>'}</b></div>`;
    const alertasHtml = d ? alertas(a, d).map(t2 => `<span class="alerta">${t2}</span>`).join('') : '';
    return `
      <div class="actual">
        <div class="icono-grande" aria-hidden="true">${w.emoji}</div>
        <div>
          <div class="ciudad-fila">
            <span class="ciudad-nombre">${c.n}</span>
            <button class="estrella${fav ? ' on' : ''}" data-fav="${c.n}" aria-label="Favorita">${fav ? '★' : '☆'}</button>
          </div>
          <div class="dep-nombre">${c.dep === 'Asunción' ? 'Capital del país' : 'Departamento ' + c.dep}</div>
          <div class="temp-fila">
            <span class="temp-grande" style="color:${esNumero(t) ? capaTemp(t) : 'inherit'}">${esNumero(t) ? Math.round(aU(t)) + '°' + UT() : '--'}</span>
            <span class="minmax">${d ? `↑ ${grados(d.daily.temperature_2m_max[0])} ↓ ${grados(d.daily.temperature_2m_min[0])}` : ''}</span>
          </div>
          <div class="estado">${w.texto}</div>
        </div>
        <div class="datos">
          ${dato('Sensación térmica', d ? grados(a.apparent_temperature) + UT() : '')}
          ${dato('Humedad', d && esNumero(a.relative_humidity_2m) ? a.relative_humidity_2m + '%' : '--')}
          ${dato('Viento', d && esNumero(a.wind_speed_10m) ? Math.round(a.wind_speed_10m) + ' km/h ' + dirViento(a.wind_direction_10m) : '--')}
          ${dato('Presión', d && esNumero(a.surface_pressure) ? Math.round(a.surface_pressure) + ' hPa' : '--')}
          ${dato('Lluvia ahora', d && esNumero(a.precipitation) ? a.precipitation + ' mm' : '--')}
          ${dato('Índice UV (máx. hoy)', d && esNumero(d.daily.uv_index_max[0]) ? Math.round(d.daily.uv_index_max[0]) : '--')}
          ${dato('Amanecer', d ? '🌅 ' + String(d.daily.sunrise[0]).slice(11) : '')}
          ${dato('Atardecer', d ? '🌇 ' + String(d.daily.sunset[0]).slice(11) : '')}
          ${dato('Luna', d ? `${L.e} ${L.t} · ${L.ilum}%` : '')}
          ${d ? `<div class="dato" id="aireDato"><small>Calidad del aire</small><b>…</b></div>` : ''}
        </div>
      </div>
      ${alertasHtml ? `<div class="alertas">${alertasHtml}</div>` : ''}`;
  }
  const capaTemp = t => CAPAS.temp.color(t);

  // Avisos útiles según las condiciones de ahora
  function alertas(a, d) {
    const r = [];
    if (esNumero(a.apparent_temperature) && a.apparent_temperature >= 35) r.push('🥵 Sensación térmica muy alta: hidrátate y evita el sol del mediodía');
    if (esNumero(a.apparent_temperature) && a.apparent_temperature <= 5) r.push('🥶 Sensación de frío intenso: abrígate bien');
    if (esNumero(d.daily.uv_index_max[0]) && d.daily.uv_index_max[0] >= 8) r.push('☀️ Índice UV muy alto hoy: usa protector solar');
    if ([95, 96, 99].includes(a.weather_code)) r.push('⛈️ Tormenta eléctrica en la zona ahora');
    if (esNumero(a.wind_speed_10m) && a.wind_speed_10m >= 40) r.push('💨 Viento fuerte');
    const i = horaInicio(d);
    const prox = d.hourly.precipitation_probability.slice(i, i + 4).filter(esNumero);
    if (prox.length && Math.max(...prox) >= 70) r.push('🌧️ Alta probabilidad de lluvia en las próximas horas');
    return r;
  }

  function pintarPrevio(c) {
    $('detalle').innerHTML = htmlCabecera(c, datos[c.n] || null, null);
  }
  function pintarErrorDetalle(c, e) {
    const msg = e && e.tipo === 'limite'
      ? 'Open-Meteo recibió demasiadas consultas. Espera un minuto e inténtalo de nuevo.'
      : 'No se pudo cargar el pronóstico de ' + c.n + '. Revisa tu conexión.';
    $('detalle').innerHTML = htmlCabecera(c, datos[c.n] || null, null, true).replace(/<span class="esq">[^<]*<\/span>/g, '--') +
      `<div class="vacio">⚠️ ${msg}<br><button class="btn" id="reintentar">Reintentar</button></div>`;
    $('reintentar').addEventListener('click', () => { if (hayDatos) dibujarDetalle(); else actualizarTodo(true); });
  }

  async function dibujarDetalle() {
    const c = porNombre.get(seleccionada);
    const mi = ++tokenDetalle;
    const previo = detalleActual && detalleActual.c.n === c.n;
    if (!previo) pintarPrevio(c);               // enseguida se ve la ciudad elegida, con lo que ya sabemos
    $('detalle').setAttribute('aria-busy', 'true');
    try {
      const d = await cargarDetalle(c);
      if (mi !== tokenDetalle) return;          // el usuario ya eligió otra ciudad
      detalleActual = { c, d };
      datos[c.n] = Object.assign({}, datos[c.n] || {}, d.current);   // la lista y el mapa quedan iguales al detalle
      document.body.classList.toggle('noche', d.current.is_day === 0);
      pintarDetalle();
      const w = clima(d.current.weather_code, d.current.is_day);
      anunciar(`${c.n}: ${grados(d.current.temperature_2m)} grados, ${w.texto}`);
      refrescarVistas();
    } catch (e) {
      if (mi !== tokenDetalle) return;
      if (previo) aviso('No se pudo actualizar el pronóstico de ' + c.n + '. Se muestran los últimos datos.');
      else { detalleActual = null; pintarErrorDetalle(c, e); }
    } finally {
      if (mi === tokenDetalle) $('detalle').setAttribute('aria-busy', 'false');
    }
  }

  function pintarDetalle() {
    const { c, d } = detalleActual;
    $('detalle').innerHTML = htmlCabecera(c, d.current, d) + `
      <div class="pestanas" role="tablist">
        <button class="pestana${pestana === 'horas' ? ' on' : ''}" data-tab="horas" role="tab" aria-selected="${pestana === 'horas'}">Próximas horas</button>
        <button class="pestana${pestana === 'grafico' ? ' on' : ''}" data-tab="grafico" role="tab" aria-selected="${pestana === 'grafico'}">Gráfico 24 h</button>
        <button class="pestana${pestana === 'dias' ? ' on' : ''}" data-tab="dias" role="tab" aria-selected="${pestana === 'dias'}">Próximos días</button>
      </div>
      <div id="pronostico">${htmlPronostico(d)}</div>`;
    llenarAire(c);
  }
  $('detalle').addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { alternarFav(fav.dataset.fav); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab && detalleActual) { pestana = tab.dataset.tab; pintarDetalle(); }
  });

  // Posición de la hora actual dentro de la lista "hourly" de la API
  function horaInicio(d) {
    const ahora = String(d.current.time).slice(0, 13);
    const i = d.hourly.time.findIndex(h => String(h).slice(0, 13) >= ahora);
    return Math.max(0, i);
  }

  function htmlPronostico(d) {
    const inicio = horaInicio(d);
    if (pestana === 'horas') {
      return '<div class="fila-scroll">' + d.hourly.time.slice(inicio, inicio + 24).map((h, i) => {
        const k = inicio + i;
        const w = clima(d.hourly.weather_code[k], d.hourly.is_day[k]);
        return `<div class="mini"><div>${String(h).slice(11, 16)}</div><div class="e">${w.emoji}</div>
          <b>${grados(d.hourly.temperature_2m[k])}</b><div class="lluvia">💧${d.hourly.precipitation_probability[k] ?? 0}%</div></div>`;
      }).join('') + '</div>';
    }
    if (pestana === 'grafico') return graficoHoras(d, inicio);
    const nombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const mins = d.daily.temperature_2m_min.filter(esNumero), maxs = d.daily.temperature_2m_max.filter(esNumero);
    const minG = Math.min(...mins), maxG = Math.max(...maxs), rango = (maxG - minG) || 1;
    return '<div class="dias">' + d.daily.time.map((f, i) => {
      const fecha = new Date(f + 'T12:00:00');
      const w = clima(d.daily.weather_code[i], 1);
      const mn = d.daily.temperature_2m_min[i], mx = d.daily.temperature_2m_max[i];
      const izq = esNumero(mn) ? (mn - minG) / rango * 100 : 0, ancho = esNumero(mn) && esNumero(mx) ? Math.max(8, (mx - mn) / rango * 100) : 8;
      return `<div class="mini"><div>${i === 0 ? 'Hoy' : nombres[fecha.getDay()] + ' ' + fecha.getDate()}</div><div class="e">${w.emoji}</div>
        <b>${grados(mx)}</b> <span style="color:var(--suave)">${grados(mn)}</span>
        <div class="barra-rango"><i style="left:${izq.toFixed(0)}%;width:${Math.min(ancho, 100 - izq).toFixed(0)}%"></i></div>
        <div class="lluvia">💧${d.daily.precipitation_probability_max[i] ?? 0}%</div></div>`;
    }).join('') + '</div>';
  }

  // Gráfico de temperatura de las próximas 24 horas (SVG dibujado a mano)
  function graficoHoras(d, inicio) {
    const T = [], P = [], Hs = [];
    for (let i = 0; i < 24 && inicio + i < d.hourly.time.length; i++) {
      const t = d.hourly.temperature_2m[inicio + i];
      if (!esNumero(t)) continue;
      T.push(t);
      P.push(d.hourly.precipitation_probability[inicio + i] ?? 0);
      Hs.push(String(d.hourly.time[inicio + i]).slice(11, 16));
    }
    if (T.length < 2) return '<div class="vacio">No hay datos suficientes para el gráfico.</div>';
    const An = 720, Al = 230, mI = 36, mD = 14, mS = 22, mB = 32;
    const tmin = Math.floor(Math.min(...T)) - 1, tmax = Math.ceil(Math.max(...T)) + 1;
    const x = i => mI + i * (An - mI - mD) / (T.length - 1);
    const y = t => mS + (tmax - t) * (Al - mS - mB) / (tmax - tmin);
    const linea = T.map((t, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(t).toFixed(1)).join('');
    const area = linea + `L${x(T.length - 1).toFixed(1)} ${Al - mB}L${x(0).toFixed(1)} ${Al - mB}Z`;
    const alto = Al - mS - mB;
    let barras = '', etiquetas = '', puntos = '';
    T.forEach((t, i) => {
      const h = P[i] / 100 * alto * 0.5;
      barras += `<rect x="${(x(i) - 4).toFixed(1)}" y="${(Al - mB - h).toFixed(1)}" width="8" height="${h.toFixed(1)}" rx="2" fill="#5cc8ff" opacity="0.35"/>`;
      if (i % 3 === 0) {
        etiquetas += `<text x="${x(i).toFixed(1)}" y="${Al - 10}" text-anchor="middle">${Hs[i]}</text>`;
        puntos += `<circle cx="${x(i).toFixed(1)}" cy="${y(t).toFixed(1)}" r="3.5" fill="${capaTemp(t)}" stroke="#fff" stroke-width="1"/>` +
          `<text class="valor" x="${x(i).toFixed(1)}" y="${(y(t) - 9).toFixed(1)}" text-anchor="middle">${Math.round(t)}°</text>`;
      }
    });
    const guias = [tmin, (tmin + tmax) / 2, tmax].map(t =>
      `<line x1="${mI}" x2="${An - mD}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="rgba(148,163,184,0.2)"/>` +
      `<text x="${mI - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${Math.round(t)}°</text>`).join('');
    return `<svg class="grafico" viewBox="0 0 ${An} ${Al}" role="img" aria-label="Temperatura de las próximas 24 horas">
      <defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347" stop-opacity="0.45"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></linearGradient></defs>
      ${guias}${barras}<path d="${area}" fill="url(#gArea)"/><path d="${linea}" fill="none" stroke="#ffb347" stroke-width="2.5" stroke-linejoin="round"/>${puntos}${etiquetas}
      <text x="${An - mD}" y="12" text-anchor="end">Barras azules: probabilidad de lluvia</text></svg>`;
  }

  // ============ 8) ACCIONES DEL USUARIO ============
  function escribirHash() {
    try {
      const p = new URLSearchParams();
      p.set('c', seleccionada);
      if (capaId !== 'temp') p.set('capa', capaId);
      history.replaceState(null, '', '#' + p.toString());
    } catch (e) { /* algunos navegadores no permiten cambiar la dirección en archivos locales */ }
  }

  function refrescarVistas() {
    pintarDeps();
    dibujarPuntos();
    dibujarLista();
    dibujarStats();
    pintarChip();
  }

  function elegir(nombre, op) {
    op = op || {};
    const c = porNombre.get(nombre);
    if (!c) return;
    seleccionada = nombre;
    guardar('clima-py-ultima', nombre);
    escribirHash();
    // Si la ciudad es chica y el mapa está lejos, nos acercamos; si ya hay zoom, solo se centra
    if (!op.desdeMapa && c.g === 3 && nivelZoom() < 1.7) centrarEn(c, 3);
    else centrarEn(c);
    dibujarPuntos();
    dibujarLista();
    pintarChip();
    dibujarDetalle();
    // Si el panel de detalle quedó fuera de la pantalla (arriba), subimos hasta él
    if ($('detalle').getBoundingClientRect().bottom < 60) $('detalle').scrollIntoView({ behavior: REDUCIDO ? 'auto' : 'smooth', block: 'start' });
  }

  function filtrarDep(nombre) {
    depFiltro = nombre;
    $('filtroDep').value = nombre;
    pintarDeps();
    if (nombre) ajustarA(infoDep[nombre]); else irA({ x: 0, y: 0, w: W });
    dibujarPuntos();
    dibujarLista();
  }
  function limpiarFiltros() {
    consulta = '';
    $('buscador').value = '';
    filtrarDep('');
  }

  $('buscador').addEventListener('input', e => {
    consulta = e.target.value.trim().toLowerCase();
    dibujarPuntos();
    dibujarLista();
  });
  $('buscador').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const primera = CIUDADES.filter(coincide).sort((a, b) => a.n.localeCompare(b.n, 'es'))[0];
      if (primera) elegir(primera.n, { zoom: true });
    } else if (e.key === 'Escape') { limpiarFiltros(); }
  });
  $('orden').addEventListener('change', dibujarLista);
  $('filtroDep').addEventListener('change', e => filtrarDep(e.target.value));

  $('btnUbicacion').addEventListener('click', () => {
    if (!navigator.geolocation) { aviso('Tu navegador no permite usar la ubicación.'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      let mejor = null, dmin = Infinity;
      CIUDADES.forEach(c => {
        const km = distanciaKm(pos.coords.latitude, pos.coords.longitude, c.lat, c.lon);
        if (km < dmin) { dmin = km; mejor = c; }
      });
      if (!mejor) return;
      if (filtroActivo()) limpiarFiltros();
      elegir(mejor.n, { zoom: true });
      aviso(dmin > 60 ? `La ciudad más cercana es ${mejor.n}, a ${Math.round(dmin)} km.` : `Ciudad más cercana: ${mejor.n} (a ${Math.round(dmin)} km)`);
    }, () => aviso('No pude obtener tu ubicación (revisa el permiso del navegador).'), { timeout: 9000 });
  });

  // Indicador de estado de los datos (en vivo / viejos / sin conexión)
  function pintarEstado() {
    const el = $('estado');
    let clase, texto;
    if (!ultimaOk) { clase = cargando ? 'carga' : 'error'; texto = cargando ? 'Cargando…' : 'Sin datos'; }
    else {
      const min = Math.round((Date.now() - ultimaOk) / 60000), hora = fmtHora(new Date(ultimaOk));
      if (ultimoError) { clase = 'error'; texto = `Sin conexión · datos de las ${hora}`; }
      else if (min >= 45) { clase = 'viejo'; texto = `Datos de hace ${min} min`; }
      else { clase = 'ok'; texto = `En vivo · actualizado ${hora}`; }
    }
    el.className = 'pill ' + clase;
    el.textContent = '● ' + texto;
  }

  let reintentoAuto = 0;
  async function actualizarTodo(manual) {
    if (cargando) return;
    // Límite anti-spam: no se aplica si el último intento falló (así "Reintentar" siempre funciona)
    if (manual === true && !ultimoError && Date.now() - ultimoIntento < 15000) { aviso('Ya se actualizó hace unos segundos.'); return; }
    cargando = true;
    ultimoIntento = Date.now();
    $('btnActualizar').disabled = true;
    clearTimeout(reintentoAuto);
    pintarEstado();
    let ok = false, errorFinal = null;
    try {
      const r = await cargarTodas();
      ultimaOk = Date.now(); ultimoError = false; ok = true; hayDatos = true;
      guardar('clima-py-datos', JSON.stringify({ t: ultimaOk, datos }));
      if (r.ok < r.total) aviso('Algunas ciudades no se pudieron actualizar.');
    } catch (e) {
      errorFinal = e;
      ultimoError = true;
      aviso(e && e.tipo === 'limite' ? 'Open-Meteo recibió demasiadas consultas. Espera un minuto.' : 'No se pudo actualizar el clima. Revisa tu conexión.');
      reintentoAuto = setTimeout(() => { if (!document.hidden) actualizarTodo(); }, 60000);   // vuelve a intentar en un minuto
    }
    cargando = false;
    $('btnActualizar').disabled = false;
    pintarEstado();
    refrescarVistas();
    if (ok) { cacheDetalle.clear(); dibujarDetalle(); }
    else if (!detalleActual) {                         // primer arranque sin datos: error claro con "Reintentar"
      tokenDetalle++;
      pintarErrorDetalle(porNombre.get(seleccionada), errorFinal);
      $('detalle').setAttribute('aria-busy', 'false');
    }
  }
  $('btnActualizar').addEventListener('click', () => actualizarTodo(true));

  // Solo se actualiza sola si la pestaña está visible (así no se gastan consultas a la API)
  setInterval(() => { if (!document.hidden) actualizarTodo(); }, INTERVALO);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - ultimaOk > INTERVALO) actualizarTodo();
  });
  setInterval(pintarEstado, 30000);

  let temporizador;
  window.addEventListener('resize', () => { clearTimeout(temporizador); temporizador = setTimeout(dibujarPuntos, 150); });

  // ============ 9) ARRANQUE ============
  const deps = [...new Set(CIUDADES.map(c => c.dep))].sort((a, b) => a.localeCompare(b, 'es'));
  $('filtroDep').innerHTML = `<option value="">Todo el país (${CIUDADES.length})</option>` +
    deps.map(n => `<option value="${n}">${n} (${CIUDADES.filter(c => c.dep === n).length})</option>`).join('');
  $('subtitulo').textContent = `${CIUDADES.length} ciudades · ${GEO.deps.length} departamentos`;

  pintarCapas();
  dibujarMapaBase();
  pintarChip();
  dibujarLista();
  pintarEstado();
  escribirHash();
  actualizarTodo();
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
