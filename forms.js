/* ============================================================
   Mr. Dim Sum — form delivery
   Every form on the site (feedback, in-store reviews, reservations,
   contact) posts to the restaurant's inbox in the Apnosh portal,
   so responses stay in-house instead of going to a customer's
   email app. The portal also emails the owners a copy.

   Each form carries two hidden fields the portal uses to catch bots:
     _gotcha  must stay empty (people never see it, bots fill it in)
     _ts      when the page opened; instant submits are treated as bots
   ============================================================ */
(function () {
  var ENDPOINT = 'https://portal.apnosh.com/api/forms/submit/mr-dim-sum';
  var openedAt = Date.now();

  /* Add the hidden bot-check field to a form. Call once per form on page load. */
  function prepare(form) {
    if (form.querySelector('input[name="_gotcha"]')) return;
    var trap = document.createElement('input');
    trap.type = 'text';
    trap.name = '_gotcha';
    trap.tabIndex = -1;
    trap.autocomplete = 'off';
    trap.setAttribute('aria-hidden', 'true');
    trap.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
    form.appendChild(trap);
  }

  /* Send a form. kind: feedback | reservation | contact.
     extra: fields to add that aren't inputs in the form (e.g. where it came from).
     Resolves to { ok: true } or { ok: false, error: 'message to show' }. */
  function send(form, kind, extra) {
    var data = new URLSearchParams();
    new FormData(form).forEach(function (value, key) {
      if (typeof value === 'string') data.append(key, value.trim());
    });
    Object.keys(extra || {}).forEach(function (key) { data.append(key, extra[key]); });
    data.set('_ts', String(openedAt));
    data.set('_source', window.location.href);

    return fetch(ENDPOINT + '?kind=' + encodeURIComponent(kind), { method: 'POST', body: data })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok) return { ok: true };
          return { ok: false, error: body.error || 'Something went wrong. Please try again.' };
        });
      })
      .catch(function () {
        return { ok: false, error: 'We couldn’t send that. Check your connection and try again.' };
      });
  }

  window.MDSForms = { prepare: prepare, send: send };
})();
