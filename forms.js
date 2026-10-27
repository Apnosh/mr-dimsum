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
  var ENDPOINT = 'https://portal.apnosh.com/api/forms/submit/mr-dim-sum-muwyyhwx';
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
      /* skip blanks (optional fields left empty), but keep the bot trap even when empty */
      if (typeof value === 'string' && (value.trim() || key === '_gotcha')) data.append(key, value.trim());
    });
    Object.keys(extra || {}).forEach(function (key) { data.append(key, extra[key]); });
    data.set('_ts', String(openedAt));
    data.set('_source', window.location.href);

    return fetch(ENDPOINT + '?kind=' + encodeURIComponent(kind), { method: 'POST', body: data })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (res.ok) {
            /* tell Analytics (the Apnosh tag's gtag) a guest sent a form, so inquiries can be traced to where they came from */
            if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form_type: kind, transport_type: 'beacon' });
            return { ok: true };
          }
          return { ok: false, error: body.error || 'Something went wrong. Please try again.' };
        });
      })
      .catch(function () {
        return { ok: false, error: 'We couldn’t send that. Check your connection and try again.' };
      });
  }

  /* ============================================================
     The feedback questions, from Apnosh.
     The owner keeps the survey's questions in the Apnosh portal
     (Website > What guests are saying > Your questions): stars,
     written, or a choice. Each feedback form marks where they go:

       <div data-apnosh-questions="feedback"> ...today's questions... </div>
       <div data-apnosh-questions="review">   ...today's questions... </div>

     The questions already in the page are the fallback. If Apnosh
     can't be reached, or the owner hasn't written their own list,
     they stay exactly as they are. Otherwise they're replaced with
     the owner's list, drawn in that page's own style.
     ============================================================ */
  var QUESTIONS_URL = ENDPOINT.replace('/api/forms/submit/', '/api/public/feedback/');
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var asked = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  /* the question's words, and "(optional)" or "*" the way this page marks them */
  function wordsFor(q, skin) {
    var label = el(skin === 'review' ? 'span' : 'span', skin === 'review' ? 'review-label' : 'star-rating-label', q.label);
    if (skin === 'review') { if (!q.required) label.appendChild(el('span', null, ' (optional)')); }
    else if (q.required) label.appendChild(document.createTextNode(' *'));
    return label;
  }
  function starsFor(q, skin) {
    var box = el('div', skin === 'review' ? 'stars' : 'star-rating');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', q.label);
    for (var n = 5; n >= 1; n--) {
      var id = 'q-' + slug(q.key) + '-' + n;
      var input = el('input'); input.type = 'radio'; input.id = id; input.name = q.key; input.value = String(n);
      var lab = el('label'); lab.htmlFor = id; lab.setAttribute('aria-label', q.label + ': ' + n + (n === 1 ? ' star' : ' stars')); lab.innerHTML = STAR;
      box.appendChild(input); box.appendChild(lab);
    }
    return box;
  }
  function choiceFor(q, skin) {
    var box = el('div', skin === 'review' ? 'chips' : 'recommend-options');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', q.label);
    q.options.forEach(function (o, i) {
      var id = 'q-' + slug(q.key) + '-' + i;
      var input = el('input'); input.type = 'radio'; input.id = id; input.name = q.key; input.value = o;
      var lab = el('label', null, o); lab.htmlFor = id;
      if (skin === 'review') { box.appendChild(input); box.appendChild(lab); }
      else { var wrap = el('div', 'recommend-option'); wrap.appendChild(input); wrap.appendChild(lab); box.appendChild(wrap); }
    });
    return box;
  }
  function textFor(q, skin) {
    var input = el('input'); input.type = 'text'; input.name = q.key; input.id = 'q-' + slug(q.key); input.maxLength = 1000;
    return input;
  }

  /* one page's questions, in the owner's order; a run of stars questions shares one block */
  function draw(box, questions) {
    var skin = box.getAttribute('data-apnosh-questions') === 'review' ? 'review' : 'feedback';
    var out = document.createDocumentFragment();
    var run = null;
    questions.forEach(function (q) {
      if (q.kind === 'stars') {
        if (!run) {
          run = el('div', skin === 'review' ? 'review-section' : 'form-group');
          run.appendChild(el('span', skin === 'review' ? 'review-label' : 'star-rating-label', skin === 'review' ? 'Rate the details' : 'Rate Each Area'));
          run.grid = skin === 'review' ? run : run.appendChild(el('div', 'category-ratings'));
          out.appendChild(run);
        }
        var row = el('div', skin === 'review' ? 'detail-row' : 'category-rating');
        row.appendChild(el('span', skin === 'review' ? 'detail-row__name' : 'category-rating__name', q.label + (q.required ? ' *' : '')));
        row.appendChild(starsFor(q, skin));
        run.grid.appendChild(row);
        return;
      }
      run = null;
      var group = el('div', skin === 'review' ? 'review-section' : 'form-group');
      if (q.kind === 'choice') { group.appendChild(wordsFor(q, skin)); group.appendChild(choiceFor(q, skin)); }
      else {
        var lab = wordsFor(q, skin); var input = textFor(q, skin);
        var real = el('label', lab.className); real.htmlFor = input.id; while (lab.firstChild) real.appendChild(lab.firstChild);
        group.appendChild(real);
        if (skin === 'review') { var f = el('div', 'review-field'); f.appendChild(input); group.appendChild(f); } else group.appendChild(input);
      }
      out.appendChild(group);
    });
    box.innerHTML = '';
    box.appendChild(out);
  }

  /* Ask Apnosh for the owner's questions and draw them in every marked spot. Resolves to the list it drew, or null
     when the page keeps its own. Never throws, never blanks the page. */
  function questions() {
    var boxes = document.querySelectorAll('[data-apnosh-questions]');
    if (!boxes.length) return Promise.resolve(null);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(QUESTIONS_URL, ctl ? { signal: ctl.signal } : {})
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        clearTimeout(timer);
        if (!body || !body.custom || !Array.isArray(body.questions)) return null;
        /* a guest who already started answering keeps what they have */
        var touched = false;
        boxes.forEach(function (b) { if (b.querySelector('input:checked') || [].some.call(b.querySelectorAll('input[type=text],textarea'), function (i) { return i.value.trim(); })) touched = true; });
        if (touched) return null;
        boxes.forEach(function (b) { draw(b, body.questions); });
        asked = body.questions;
        return asked;
      })
      .catch(function () { clearTimeout(timer); return null; });
  }

  /* the required questions this form still needs, by their words; empty when it's complete (the portal checks too) */
  function missing(form) {
    return (asked || []).filter(function (q) {
      if (!q.required) return false;
      var picked = form.querySelector('input[name="' + q.key + '"]:checked');
      if (q.kind === 'text') { var t = form.querySelector('[name="' + q.key + '"]'); return !t || !t.value.trim(); }
      return !picked;
    }).map(function (q) { return q.label; });
  }

  window.MDSForms = { prepare: prepare, send: send, questions: questions, missing: missing };
})();
