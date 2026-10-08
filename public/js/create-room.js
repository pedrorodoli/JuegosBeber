/* Formularios de "Crear sala": steppers numéricos, envío con estado de carga y errores en línea */
(function () {
  'use strict';

  function getUserUuid() {
    let uuid = localStorage.getItem('userUUID');
    if (!uuid) {
      uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      localStorage.setItem('userUUID', uuid);
    }
    return uuid;
  }
  window.getUserUuid = window.getUserUuid || getUserUuid;

  /**
   * opts.gameType  tipo de juego para /api/rooms/:gameType
   * opts.form      id del formulario
   * opts.build     (form) => objeto a enviar (sin creatorId)
   * opts.creatorId opcional: función que devuelve el id del creador
   */
  window.tpCreateRoom = function (opts) {
    const form = document.getElementById(opts.form);
    if (!form) return;
    const submit = form.querySelector('[type=submit]');
    const errorBox = form.querySelector('.tp-form-error');
    const label = submit ? submit.innerHTML : '';

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (errorBox) errorBox.hidden = true;
      if (submit) { submit.disabled = true; submit.innerHTML = '<span class="tp-spinner" aria-hidden="true"></span> Creando sala'; }
      try {
        const payload = opts.build(form);
        payload.creatorId = opts.creatorId ? opts.creatorId() : getUserUuid();
        const response = await fetch('/api/rooms/' + opts.gameType, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          const data = await response.json();
          window.location.href = '/game/' + opts.gameType + '/' + data.roomId;
          return;
        }
        let msg = 'No se pudo crear la sala. Inténtalo de nuevo.';
        try { const err = await response.json(); if (err && err.message) msg = 'No se pudo crear la sala: ' + err.message; } catch (_) {}
        throw new Error(msg);
      } catch (err) {
        const msg = err && err.message && !/fetch/i.test(err.message) ? err.message : 'Sin conexión con el servidor. Revisa tu internet e inténtalo otra vez.';
        if (errorBox) { errorBox.textContent = msg; errorBox.hidden = false; } else { alert(msg); }
        if (submit) { submit.disabled = false; submit.innerHTML = label; }
      }
    });
  };
})();
