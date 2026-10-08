// Estadísticas (clon) · mismo API que el original: /api/analytics/stats-data, /auth, /reset-stats y socket analytics:*
(() => {
  const $ = (id) => document.getElementById(id);
  const GAMES = {
    autobus: ['🚌', 'El Autobús'], pyramid: ['🔺', 'La Pirámide'], 'horse-race': ['🐴', 'Carrera de caballos'], roulette: ['🎡', 'Ruleta'],
    voting: ['🗳️', 'Votaciones'], bolita: ['🔴', 'La Bolita'], cofres: ['🧰', 'Cofres del Tesoro'], lamente: ['🧠', 'La Mente'], imitador: ['🎭', 'El Imitador'],
  };
  const SOURCES = { WhatsApp: '💬', Instagram: '📸', TikTok: '🎵', Facebook: '👍', 'X / Twitter': '✖️', Google: '🔎', 'Otros buscadores': '🧭', Telegram: '✈️', YouTube: '▶️', 'Directo / enlace': '🔗' };
  const DELTA_LABEL = { today: 'vs ayer a esta hora', yesterday: 'vs anteayer', '7days': 'vs 7 días anteriores', '30days': 'vs 30 días anteriores' };
  const DEV = { mobile: ['Móvil', '#ff5a3c'], desktop: ['Ordenador', '#8fe3b0'], tablet: ['Tablet', '#f3c969'] };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('es-ES');
  const gameOf = (g) => GAMES[g] || ['🎲', g || 'Otro'];

  let range = 'today', os = 'all', placeTab = 'cities', lastData = null;
  const lastHtml = {};
  // Solo se re-pinta una sección si su contenido cambia (sin parpadeos en el refresco automático)
  function paint(id, html) { if (lastHtml[id] === html) return; lastHtml[id] = html; $(id).innerHTML = html; }

  function pathLabel(p) {
    if (!p || p === '/') return ['🏠', 'Inicio'];
    let m = p.match(/^\/game\/([^/]+)/); if (m) { const g = gameOf(m[1]); return [g[0], 'Jugando a ' + g[1]]; }
    m = p.match(/^\/rooms\/([^/]+)/); if (m) { const g = gameOf(m[1]); return [g[0], 'Salas de ' + g[1]]; }
    m = p.match(/^\/admin\/([^/]+)/); if (m) { const g = gameOf(m[1]); return ['🛠️', 'Creando sala · ' + g[1]]; }
    if (/^\/(terms|privacy|contact)/.test(p)) return ['📄', { '/terms': 'Términos', '/privacy': 'Privacidad', '/contact': 'Contacto' }[p] || p];
    if (/^\/stats/.test(p)) return ['📊', 'Estadísticas'];
    return ['📄', p];
  }
  const ago = (d) => { const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000)); if (s < 60) return s + ' s'; if (s < 3600) return Math.round(s / 60) + ' min'; if (s < 86400) return Math.round(s / 3600) + ' h'; return Math.round(s / 86400) + ' d'; };
  const devIcon = (d) => ({ mobile: 'bi-phone', tablet: 'bi-tablet', desktop: 'bi-laptop' }[d] || 'bi-display');

  function bars(items, { max, icon, name, sub, val, valSub, click, active } = {}) {
    if (!items || !items.length) return '<li class="st-empty">Sin datos todavía.</li>';
    const top = max || Math.max(...items.map((i) => Number(val(i)) || 0), 1);
    return items.map((it) => {
      const v = Number(val(it)) || 0;
      const attrs = click ? ` data-k="${esc(click(it))}"` : '';
      return `<li class="st-bar${click ? ' is-click' : ''}${active && active(it) ? ' is-active' : ''}" style="--p:${(v / top).toFixed(3)}"${attrs}>${icon ? `<span class="st-bar-ico">${icon(it)}</span>` : ''}<span class="st-bar-name">${esc(name(it))}${sub ? `<small>${esc(sub(it))}</small>` : ''}</span><span class="st-bar-val">${fmt(v)}${valSub ? `<small>${esc(valSub(it))}</small>` : ''}</span></li>`;
    }).join('');
  }

  function delta(el, cur, prev) {
    el.className = 'st-delta';
    if (!prev || prev === 0 || range === 'all') { el.textContent = range === 'all' ? 'desde el principio' : ''; return; }
    const pct = Math.round(((cur - prev) / prev) * 100);
    el.classList.add(pct >= 0 ? 'up' : 'down');
    el.textContent = `${pct >= 0 ? '▲ +' : '▼ '}${pct} % ${DELTA_LABEL[range] || ''}`;
  }

  // ------------------------------------------------------------------ render
  function render(d) {
    lastData = d;
    const t = d.totals || {};
    $('kpiActive').textContent = fmt(d.activeUsersCount); $('liveCount').textContent = fmt(d.activeUsersCount);
    const people = d.activeUsersList || [];
    $('kpiActiveSub').textContent = people.length ? people.slice(0, 3).map((u) => `${u.flag || ''} ${u.city || 'Desconocida'}`).join(' · ') : 'Nadie conectado';
    $('kpiVisitors').textContent = fmt(t.uniqueVisitors); $('kpiPageviews').textContent = fmt(t.pageviews);
    $('kpiPeak').textContent = (t.peakHourFormatted || '--:--').replace(/:00/g, '').replace(/\s*-\s*/, '–') + (t.peakHourFormatted ? 'h' : ''); $('kpiAvgDay').textContent = fmt(t.avgVisitorsPerDay); $('kpiPpv').textContent = t.avgPagesPerVisit || 0;
    const p = d.previousTotals || {};
    delta($('dVisitors'), t.uniqueVisitors, p.uniqueVisitors); delta($('dPageviews'), t.pageviews, p.pageviews);

    // Ahora mismo
    const lr = d.liveRooms;
    if (lr) {
      $('roomsPill').textContent = `${lr.totalRooms} ${lr.totalRooms === 1 ? 'sala' : 'salas'} · ${lr.totalPlayers} ${lr.totalPlayers === 1 ? 'jugador' : 'jugadores'}`;
      $('roomsPill').className = 'st-pill' + (lr.totalPlayers ? ' st-pill--on' : '');
      paint('liveGames', lr.byGame.length ? lr.byGame.map((g) => { const [ic, nm] = gameOf(g.gameType); return `<div class="st-live-game${g.players ? ' is-hot' : ''}"><span class="ico">${ic}</span><b>${esc(nm)}</b><span>${g.rooms} ${g.rooms === 1 ? 'sala' : 'salas'} · ${g.players} ${g.players === 1 ? 'conectado' : 'conectados'}</span></div>`; }).join('') : '<p class="st-empty">No hay salas abiertas ahora mismo.</p>');
      paint('liveRooms', lr.rooms.length ? lr.rooms.map((r) => { const [ic, nm] = gameOf(r.gameType); return `<li><span class="st-dot${r.connected ? ' on' : ''}"></span><span class="nm">${ic} ${esc(r.name || r.id)}<small>${esc(nm)}${r.phase ? ' · ' + esc(r.phase) : ''}${r.hasPassword ? ' · 🔒' : ''}${r.isPublic ? '' : ' · privada'}</small></span><span class="ct">${r.connected} en línea</span></li>`; }).join('') : '<li class="st-empty">Sin salas.</li>');
    }
    paint('livePeople', people.length ? people.map((u) => { const [ic, lb] = pathLabel(u.current_path); return `<li><span>${u.flag || '🌐'}</span><span class="nm">${ic} ${esc(lb)}<small>${esc(u.city || 'Desconocida')} · ${esc(u.os_name || '')} ${esc(u.browser_name || '')}</small></span><span class="ct"><i class="bi ${devIcon(u.device_type)}"></i> ${Math.max(1, Math.round((u.duration_seconds || 0) / 60))} min</span></li>`; }).join('') : '<li class="st-empty">Nadie conectado ahora.</li>');

    renderTimeline(d.timeline || [], d.range);
    paint('games', bars(d.topGames, { icon: (g) => gameOf(g.game)[0], name: (g) => gameOf(g.game)[1], val: (g) => g.sessions }));
    paint('sources', bars(d.topReferrers, { icon: (s) => SOURCES[s.source] || '🌐', name: (s) => s.source, val: (s) => s.sessions }));
    renderHours(d.hourlyDistribution || []);
    renderPlaces();
    renderDevices(d);
    paint('pages', bars(d.topPages, { icon: (pg) => pathLabel(pg.path)[0], name: (pg) => pathLabel(pg.path)[1], sub: (pg) => pg.path, val: (pg) => pg.visits, valSub: (pg) => pg.percentage + '%' }));
    renderFeed(d.recentVisits || []);
    updateMap(d.mapPoints || []);
    $('updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderTimeline(rows, rng) {
    const key = JSON.stringify(rows);
    if (lastHtml.tl === key) return; lastHtml.tl = key;
    const svg = $('tlSvg'), W = 600, H = 220, pad = 8;
    if (!rows.length) { svg.innerHTML = '<text x="300" y="110" text-anchor="middle" fill="#a9bdb2" font-size="14">Sin datos</text>'; $('tlAxis').innerHTML = ''; return; }
    const max = Math.max(...rows.map((r) => Number(r.visits) || 0), 1) * 1.1;
    const x = (i) => rows.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (rows.length - 1);
    const y = (v) => H - pad - ((Number(v) || 0) / max) * (H - pad * 2);
    const line = (k) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join(' ');
    const area = (k) => `${line(k)} L${x(rows.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
    const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${(H - pad - f * (H - pad * 2)).toFixed(1)}" y2="${(H - pad - f * (H - pad * 2)).toFixed(1)}" stroke="rgba(238,241,234,.08)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
    svg.innerHTML = `<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a3c" stop-opacity=".45"/><stop offset="1" stop-color="#ff5a3c" stop-opacity="0"/></linearGradient>
      <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fe3b0" stop-opacity=".35"/><stop offset="1" stop-color="#8fe3b0" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area('visits')}" fill="url(#ga)"/><path d="${line('visits')}" fill="none" stroke="#ff5a3c" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <path d="${area('visitors')}" fill="url(#gb)"/><path d="${line('visitors')}" fill="none" stroke="#8fe3b0" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <line id="tlCursor" x1="0" x2="0" y1="0" y2="${H}" stroke="rgba(238,241,234,.5)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
    const n = rows.length, step = Math.max(1, Math.ceil(n / 6));
    $('tlAxis').innerHTML = rows.filter((_, i) => i % step === 0 || i === n - 1).map((r) => `<span>${esc(r.time_label)}</span>`).join('');
    // Tocar o pasar el dedo muestra los valores
    const box = $('timeline'), tip = $('tlTip');
    const show = (clientX) => {
      const r = box.getBoundingClientRect(); const fx = (clientX - r.left) / r.width;
      const i = Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1))));
      const row = rows[i], px = (x(i) / W) * r.width;
      tip.hidden = false; tip.style.left = Math.min(r.width - 60, Math.max(60, px)) + 'px';
      tip.innerHTML = `${esc(row.time_label)} · <b>${fmt(row.visits)}</b> visitas · <b>${fmt(row.visitors)}</b> pers.`;
      const c = $('tlCursor'); c.setAttribute('x1', x(i)); c.setAttribute('x2', x(i)); c.setAttribute('visibility', 'visible');
    };
    box.onpointermove = (e) => show(e.clientX); box.onpointerdown = (e) => show(e.clientX);
    box.onpointerleave = () => { tip.hidden = true; const c = $('tlCursor'); if (c) c.setAttribute('visibility', 'hidden'); };
  }

  function renderHours(hours) {
    const max = Math.max(...hours.map((h) => h.visits), 1);
    let peak = -1, pv = 0; hours.forEach((h, i) => { if (h.visits > pv) { pv = h.visits; peak = i; } });
    paint('hours', hours.map((h, i) => `<span class="st-hour${i === peak ? ' is-peak' : ''}" style="--h:${(h.visits / max).toFixed(3)}" title="${h.hour}: ${h.visits} visitas"></span>`).join(''));
    $('hoursHint').textContent = peak >= 0 ? `más gente a las ${String(peak).padStart(2, '0')}:00` : '';
  }

  function renderPlaces() {
    const d = lastData; if (!d) return;
    if (placeTab === 'cities') paint('places', bars(d.topCities, { icon: (c) => c.flag || '🌐', name: (c) => c.city, sub: (c) => c.country_name, val: (c) => c.visits, valSub: (c) => c.percentage + '%' }));
    else paint('places', bars(d.topCountries, { icon: (c) => c.flag || '🌐', name: (c) => c.country_name || c.country_code || 'Desconocido', val: (c) => c.visits, valSub: (c) => c.percentage + '%' }));
  }

  function renderDevices(d) {
    const devs = d.devices || []; const total = devs.reduce((s, x) => s + Number(x.count), 0) || 1;
    const html = devs.map((x) => { const [, col] = DEV[x.device_type] || ['Otro', '#a9bdb2']; return `<span style="flex-grow:${x.count};background:${col}"></span>`; }).join('');
    const leg = devs.map((x) => { const [nm, col] = DEV[x.device_type] || [x.device_type || 'Otro', '#a9bdb2']; return `<span><i style="background:${col}"></i>${nm}<b>${Math.round((x.count / total) * 100)}%</b></span>`; }).join('');
    paint('devices', html);
    let lg = document.getElementById('devLegend'); if (!lg) { lg = document.createElement('div'); lg.id = 'devLegend'; lg.className = 'st-stack-legend'; $('devices').after(lg); }
    if (lg.innerHTML !== leg) lg.innerHTML = leg;
    const osNorm = (n) => (n === 'Mac OS' ? 'macOS' : n);
    const sys = {}; (d.operatingSystems || []).forEach((o) => { const k = osNorm(o.os_name); sys[k] = (sys[k] || 0) + Number(o.count); });
    paint('systems', bars(Object.entries(sys).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v), { name: (o) => o.k, val: (o) => o.v, click: (o) => o.k, active: (o) => o.k === os }));
    paint('browsers', bars(d.browsers, { name: (b) => b.browser_name, val: (b) => b.count }));
  }

  function feedItem(v, isNew) {
    const [ic, lb] = pathLabel(v.path);
    return `<li class="${isNew ? 'is-new' : ''}"><span class="fl">${v.flag || '🌐'}</span><span class="tx"><b>${ic} ${esc(lb)}</b><small>${esc(v.city || 'Desconocida')} · <i class="bi ${devIcon(v.device_type)}"></i> ${esc(v.browser_name || '')}</small></span><span class="tm" data-t="${esc(v.created_at)}">${ago(v.created_at)}</span></li>`;
  }
  function renderFeed(visits) { paint('feed', visits.length ? visits.map((v) => feedItem(v, false)).join('') : '<li class="st-empty">Todavía no hay visitas.</li>'); }
  setInterval(() => document.querySelectorAll('#feed .tm[data-t]').forEach((e) => { e.textContent = ago(e.dataset.t); }), 15000);

  // Mapa: solo se carga Leaflet si se abre la sección (ahorra datos en el móvil)
  let map = null, layer = null, pendingPoints = [];
  function updateMap(points) { pendingPoints = points; if (layer && window.L) drawPoints(); }
  function drawPoints() {
    const key = JSON.stringify(pendingPoints); if (lastHtml.map === key) return; lastHtml.map = key;
    layer.clearLayers();
    pendingPoints.forEach((pt) => {
      if (!pt.latitude || !pt.longitude) return;
      L.circleMarker([pt.latitude, pt.longitude], { radius: Math.min(16, 5 + Math.log2(pt.visits + 1) * 2.5), fillColor: '#ff5a3c', color: '#eef1ea', weight: 1.5, fillOpacity: 0.8 })
        .bindPopup(`<b>${esc(pt.city || 'Desconocida')}</b><br>${fmt(pt.visits)} visitas`).addTo(layer);
    });
  }
  $('mapMore').addEventListener('toggle', () => {
    if (!$('mapMore').open || map) return;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => {
      map = L.map('geoMap', { center: [40.2, -3.7], zoom: 4, scrollWheelZoom: false, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
      layer = L.layerGroup().addTo(map); lastHtml.map = ''; drawPoints();
    };
    js.onerror = () => { $('geoMap').innerHTML = '<p class="st-empty" style="padding:1rem">No se pudo cargar el mapa.</p>'; };
    document.head.appendChild(js);
  });

  // ------------------------------------------------------------------ datos
  let loading = false;
  async function load(manual) {
    if (loading) return; loading = true;
    if (manual) $('btnRefresh').classList.add('is-spinning');
    try {
      const res = await fetch(`/api/analytics/stats-data?range=${encodeURIComponent(range)}${os !== 'all' ? '&os=' + encodeURIComponent(os) : ''}`, { cache: 'no-store' });
      if (res.status === 401) { $('login').hidden = false; setTimeout(() => $('loginKey').focus(), 200); return; }
      render(await res.json());
    } catch (e) { console.error('Error cargando estadísticas', e); }
    finally { loading = false; $('btnRefresh').classList.remove('is-spinning'); }
  }

  $('rangeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    range = b.dataset.range; [...$('rangeSeg').children].forEach((x) => x.classList.toggle('is-on', x === b)); load(true);
  });
  function setOs(v) { os = v; [...$('osChips').children].forEach((x) => x.classList.toggle('is-on', x.dataset.os === os)); load(true); }
  $('osChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setOs(b.dataset.os); });
  $('systems').addEventListener('click', (e) => { const li = e.target.closest('[data-k]'); if (li) setOs(os === li.dataset.k ? 'all' : li.dataset.k); });
  $('placeTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; placeTab = b.dataset.t; [...$('placeTabs').children].forEach((x) => x.classList.toggle('is-on', x === b)); renderPlaces(); });
  $('btnRefresh').addEventListener('click', () => load(true));

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/analytics/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: $('loginKey').value }) }).catch(() => null);
    const ok = res && (await res.json().catch(() => ({}))).success;
    if (ok) { $('login').hidden = true; $('loginError').hidden = true; load(true); connectSocket(true); }
    else { $('loginError').hidden = false; }
  });

  $('btnReset').addEventListener('click', async () => {
    const v = await tpAsk({ title: 'Borrar todas las estadísticas', text: 'Se borran todas las visitas guardadas y no se pueden recuperar. Escribe BORRAR para confirmar.', placeholder: 'BORRAR', submitLabel: 'Borrar' });
    if (v === null) return;
    if (String(v).trim().toUpperCase() !== 'BORRAR') { tpToast('No se ha borrado nada.', { error: true }); return; }
    const res = await fetch('/api/analytics/reset-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (data.success) { tpToast('Estadísticas borradas.'); Object.keys(lastHtml).forEach((k) => delete lastHtml[k]); load(true); }
    else tpToast('No se pudieron borrar.', { error: true });
  });

  // ------------------------------------------------------------------ directo
  let socket = null;
  function connectSocket(force) {
    if (socket && !force) return;
    if (socket) socket.disconnect();
    socket = io();
    socket.on('connect', () => { $('feedStatus').textContent = '● En directo'; $('feedStatus').className = 'st-pill st-pill--on'; socket.emit('analytics:join_dashboard'); });
    socket.on('disconnect', () => { $('feedStatus').textContent = 'Desconectado'; $('feedStatus').className = 'st-pill st-pill--off'; });
    socket.on('analytics:active_count', (n) => { $('kpiActive').textContent = fmt(n); $('liveCount').textContent = fmt(n); });
    socket.on('analytics:new_visit', (v) => {
      if (v.activeCount !== undefined) { $('kpiActive').textContent = fmt(v.activeCount); $('liveCount').textContent = fmt(v.activeCount); }
      const feed = $('feed'); const empty = feed.querySelector('.st-empty'); if (empty) empty.remove();
      feed.insertAdjacentHTML('afterbegin', feedItem({ path: v.path, flag: v.flag, city: v.city, device_type: v.deviceType, browser_name: v.browserName, created_at: new Date().toISOString() }, true));
      while (feed.children.length > 30) feed.lastElementChild.remove();
      lastHtml.feed = feed.innerHTML;
    });
    socket.on('analytics:reset', () => load(true));
  }

  connectSocket();
  load(true);
  // Refresco automático solo con la pestaña visible (ahorra batería y datos)
  setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(false); });
})();
