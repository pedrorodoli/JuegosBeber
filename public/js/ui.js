/* JuegosBeber · utilidades de interfaz compartidas (avisos, diálogo de contraseña, avatares) */
(function () {
  'use strict';

  // ---------- Avisos (sustituyen a window.alert, que bloquea la pantalla) ----------
  function stack() {
    let s = document.querySelector('.tp-toast-stack');
    if (!s) {
      s = document.createElement('div');
      s.className = 'tp-toast-stack';
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      document.body.appendChild(s);
    }
    return s;
  }

  function toast(message, opts) {
    opts = opts || {};
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => toast(message, opts)); return; }
    const el = document.createElement('div');
    el.className = 'tp-toast' + (opts.error ? ' is-error' : '');
    el.textContent = String(message).replace(/^Error:\s*/i, '');
    stack().appendChild(el);
    const ttl = opts.duration || 3200;
    setTimeout(() => {
      el.classList.add('is-leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, ttl);
  }

  window.tpToast = toast;
  window.alert = function (msg) {
    const text = String(msg == null ? '' : msg);
    toast(text, { error: /error|incorrect|no existe|no se pudo|no válid|introduce|debe/i.test(text) });
  };

  // ---------- Diálogo de texto (sustituye a window.prompt donde se usa con callback) ----------
  window.tpAsk = function (opts) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'tp-dialog-backdrop';
      back.innerHTML =
        '<form class="modal-content" role="dialog" aria-modal="true">' +
          '<h2></h2><p></p>' +
          '<input class="tp-input" autocomplete="off">' +
          '<p class="tp-form-error" role="alert" hidden></p>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<button type="button" class="tp-btn tp-btn--ghost" data-cancel>Cancelar</button>' +
            '<button type="submit" class="tp-btn">Entrar</button>' +
          '</div>' +
        '</form>';
      const form = back.querySelector('form');
      form.querySelector('h2').textContent = opts.title || '';
      form.querySelector('p').textContent = opts.text || '';
      const input = form.querySelector('input');
      input.type = opts.type || 'text';
      input.placeholder = opts.placeholder || '';
      if (opts.submitLabel) form.querySelector('[type=submit]').textContent = opts.submitLabel;
      if (opts.error) { const er = form.querySelector('.tp-form-error'); er.textContent = opts.error; er.hidden = false; }
      if (opts.value) input.value = opts.value;
      const close = (val) => {
        back.classList.add('is-leaving');
        setTimeout(() => back.remove(), 180);
        resolve(val);
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); close(input.value); });
      form.querySelector('[data-cancel]').addEventListener('click', () => close(null));
      back.addEventListener('click', (e) => { if (e.target === back) close(null); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(null); }
      });
      document.body.appendChild(back);
      setTimeout(() => input.focus(), 60);
    });
  };

  // ---------- Avatar con iniciales y tono estable por nombre ----------
  window.tpAvatar = function (name) {
    const n = String(name || '?').trim() || '?';
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
    const parts = n.split(/\s+/);
    const initials = (parts[0][0] + (parts[1] ? parts[1][0] : (parts[0][1] || ''))).toUpperCase();
    const el = document.createElement('span');
    el.className = 'tp-avatar';
    el.style.setProperty('--h', String(h));
    el.setAttribute('aria-hidden', 'true');
    el.textContent = initials;
    return el;
  };
})();

/* Botón "Invitar": comparte el enlace de la sala (o lo copia) */
document.addEventListener('click', async function (e) {
  const btn = e.target.closest('[data-share]');
  if (!btn) return;
  const url = location.origin + location.pathname;
  const title = document.title;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: title, text: 'Únete a la partida', url: url }); return; } catch (_) { return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    window.tpToast('Enlace copiado. Pásalo por el grupo.');
  } catch (_) {
    window.tpToast(url, { duration: 6000 });
  }
});

/* Chip de jugador para las tiras de jugadores de las partidas */
window.tpPlayerChip = function (name, opts) {
  opts = opts || {};
  const li = document.createElement(opts.tag || 'li');
  li.className = 'g-chip' + (opts.turn ? ' is-turn' : '') + (opts.won ? ' is-won' : '') + (opts.me ? ' is-me' : '') + (opts.className ? ' ' + opts.className : '') + (opts.offline ? ' is-offline' : '');
  if (opts.offline) li.title = 'Desconectado';
  li.appendChild(window.tpAvatar(name));
  const n = document.createElement('span');
  n.className = 'g-chip-name';
  n.textContent = name;
  li.appendChild(n);
  if (opts.meta != null && opts.meta !== '') {
    const m = document.createElement('span');
    m.className = 'g-chip-meta';
    if (opts.metaIcon) { const i = document.createElement('i'); i.className = 'bi ' + opts.metaIcon; i.setAttribute('aria-hidden', 'true'); m.appendChild(i); m.append(' '); }
    m.append(String(opts.meta));
    if (opts.metaLabel) m.title = opts.metaLabel;
    li.appendChild(m);
  }
  return li;
};

/* Mantiene visible el chip del jugador en turno dentro de la tira */
window.tpScrollTurnIntoView = function (list) {
  const el = list && list.querySelector('.is-turn');
  if (el && list.scrollWidth > list.clientWidth) {
    list.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' });
  }
};

/* Steppers numéricos (− / +) */
(function () {
  // Steppers: <div class="tp-stepper"><button data-step="-1">…<input type=number>…<button data-step="1">
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    const input = btn.parentElement.querySelector('input[type=number]');
    if (!input) return;
    const step = Number(input.step) || 1;
    const min = input.min !== '' ? Number(input.min) : -Infinity;
    const max = input.max !== '' ? Number(input.max) : Infinity;
    const cur = Number(input.value) || 0;
    const next = Math.min(max, Math.max(min, cur + step * Number(btn.dataset.step)));
    if (next !== cur) {
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.classList.remove('tp-bump'); void input.offsetWidth; input.classList.add('tp-bump');
    }
  });

})();

/* ------------------------------------------------------------------
   (clon) Anti-parpadeo global.
   Muchos juegos vuelven a pintar listas enteras con cada aviso del servidor.
   Si un elemento reaparece con EXACTAMENTE el mismo contenido que hace poco,
   no repetimos su animación de entrada (se marca .tp-static antes de pintarse).
   Las animaciones infinitas (halo de turno, pulsos) se respetan.
------------------------------------------------------------------- */
(function () {
  const seen = new Map();
  const TTL = 60000;
  const sig = (el) => el.tagName + '|' + (typeof el.className === 'string' ? el.className.replace(/\btp-static\b/, '') : '') + '|' + (el.getAttribute('style') || '') + '|' + el.innerHTML.slice(0, 3000);
  function mark(el, now) {
    if (el.closest && el.closest('svg')) return;
    const s = sig(el);
    const last = seen.get(s);
    seen.set(s, now);
    if (!last || now - last > TTL) return;
    const cs = getComputedStyle(el);
    if (cs.animationName === 'none' || /infinite/.test(cs.animationIterationCount)) return;
    el.classList.add('tp-static');
  }
  const mo = new MutationObserver((ms) => {
    const now = performance.now();
    for (const m of ms) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        mark(n, now);
        n.querySelectorAll('*').forEach((c) => mark(c, now));
      }
    }
    if (seen.size > 4000) { for (const [k, t] of seen) if (now - t > TTL) seen.delete(k); }
  });
  const start = () => mo.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

/* Solo cambia el display si es distinto (evita reiniciar animaciones de entrada) */
window.tpShow = function (el, display) { if (el && el.style.display !== display) el.style.display = display; };


/* =====================================================================
   (clon) Salas con contraseña
   - Al abrir /game/<juego>/<sala> se comprueba si la sala pide contraseña.
     Si la pide y no la tenemos (o es incorrecta), se pregunta AQUÍ, antes
     de entrar, y se avisa al momento si está mal.
   - Todos los juegos mandan después la contraseña guardada al unirse
     (antes solo lo hacían la carrera, las votaciones y el imitador).
   ===================================================================== */
(function () {
  const m = location.pathname.match(/^\/game\/([^/]+)\/([^/?#]+)/);
  // Fuera de /game/... (por ejemplo el panel de La Mente) no hay contraseña que pedir,
  // pero sí hace falta el parche de reconexión de más abajo.
  const gameType = m ? decodeURIComponent(m[1]) : null;
  const roomId = m ? decodeURIComponent(m[2]) : null;
  const KEY = 'roomPassword_' + roomId;
  let release;
  const gate = new Promise((r) => { release = r; });
  if (!m) release();

  async function check(password) {
    const uuid = localStorage.getItem('userUUID') || '';
    const r = await fetch('/api/rooms/' + encodeURIComponent(roomId) + '/access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password, uuid: uuid })
    });
    return r.json();
  }

  async function run() {
    try {
      let stored = null;
      try { stored = sessionStorage.getItem(KEY); } catch (e) {}
      let res = await check(stored);
      if (!res.exists || !res.needsPassword || res.ok) return release();
      let error = stored ? 'Contraseña incorrecta.' : '';
      for (;;) {
        const pw = await window.tpAsk({ title: 'Sala con contraseña', text: 'Pídesela a quien creó la sala.', type: 'password', placeholder: 'Contraseña', submitLabel: 'Entrar', error: error });
        if (pw === null) { location.href = '/rooms/' + encodeURIComponent(gameType); return; }
        res = await check(pw);
        if (res.ok) { try { sessionStorage.setItem(KEY, pw); } catch (e) {} return release(); }
        error = 'Contraseña incorrecta. Prueba otra vez.';
      }
    } catch (e) {
      release(); // si falla la comprobación, que decida el servidor al unirse
    }
  }

  // (clon) Reconexión: si el móvil se bloquea o cambia de red, Socket.IO vuelve a conectar
  // con un socket nuevo que ya no está en la sala. Se repite el último joinRoom para
  // volver a entrar sin recargar (el servidor reconoce al jugador por su uuid).
  function bindRejoin(sock) {
    if (sock.__tpRejoinBound) return;
    sock.__tpRejoinBound = true;
    let seen = sock.connected;
    sock.on('connect', () => {
      if (seen && sock.__tpLastJoin) sock.emit('joinRoom', sock.__tpLastJoin);
      seen = true;
    });
  }

  function patch(io) {
    const S = io && io.Socket && io.Socket.prototype;
    if (!S || S.__tpPatched) return;
    const emit = S.emit;
    S.emit = function (ev, data) {
      if (ev === 'joinRoom' && data && data.user) {
        const self = this, args = arguments;
        self.__tpLastJoin = data;
        bindRejoin(self);
        gate.then(() => {
          let pw = null;
          try { pw = sessionStorage.getItem(KEY); } catch (e) {}
          if (pw && !data.user.password) data.user.password = pw;
          emit.apply(self, args);
        });
        return this;
      }
      return emit.apply(this, arguments);
    };
    S.__tpPatched = true;
  }

  // socket.io se carga después de este archivo: parcheamos en cuanto aparece window.io
  if (window.io) patch(window.io);
  else {
    let _io;
    Object.defineProperty(window, 'io', { configurable: true, get: () => _io, set: (v) => { _io = v; patch(v); } });
  }
  if (m) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }
})();
