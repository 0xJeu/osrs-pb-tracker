export function recoveryAdminPage(nonce: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PB Tracker Recovery Admin</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #111318; color: #edf0f7; }
    main { width: min(1180px, calc(100% - 32px)); margin: 36px auto 72px; }
    h1 { margin-bottom: 6px; }
    .subtle { color: #9ba4b7; margin-top: 0; }
    .hidden { display: none !important; }
    .login-card, .controls, article { background: #1a1e27; border: 1px solid #303746; border-radius: 12px; }
    .login-card { width: min(420px, calc(100% - 34px)); margin: 48px auto; padding: 22px; }
    .login-card form { display: grid; gap: 14px; }
    .toolbar { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    .controls { padding: 16px; display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; }
    label { display: grid; gap: 6px; color: #bac2d2; font-size: 13px; }
    input, select, button { border: 1px solid #3c4659; border-radius: 8px; padding: 10px; font: inherit; }
    input, select { color: #edf0f7; background: #11151d; }
    input[readonly] { color: #9ba4b7; }
    button { color: #fff; background: #315bb6; cursor: pointer; align-self: end; }
    button.secondary { background: #343b49; }
    button.danger { background: #8d3542; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    .message { min-height: 24px; margin: 14px 2px; color: #f0c674; }
    #candidates { display: grid; gap: 14px; }
    article { padding: 16px; }
    .candidate-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    .candidate-head h2 { margin: 0 0 4px; font-size: 19px; }
    .badge { border-radius: 999px; padding: 4px 9px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; background: #51441f; }
    .badge.promoted { background: #20553b; }
    .badge.rejected { background: #633039; }
    .badge.contested { background: #674519; }
    .explanation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 18px 0 14px; }
    .insight { background: #141821; border: 1px solid #303746; border-radius: 10px; padding: 14px; }
    .insight h3, .signals h3, .metrics-title { margin: 0 0 7px; font-size: 14px; }
    .insight p { margin: 0; color: #bac2d2; line-height: 1.45; }
    .insight .insight-title { color: #edf0f7; font-weight: 700; margin-bottom: 5px; }
    .recommendation { border-width: 2px; }
    .tone-positive { border-color: #2f7655; }
    .tone-caution { border-color: #8a6c25; }
    .tone-danger { border-color: #9b4350; }
    .tone-neutral { border-color: #46536a; }
    .signals { margin: 14px 0; }
    .signal-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; list-style: none; margin: 0; padding: 0; }
    .signal-list li { border-left: 4px solid #46536a; background: #141821; border-radius: 6px; padding: 10px 12px; color: #bac2d2; line-height: 1.4; }
    .signal-list li.tone-positive { border-left-color: #2f7655; }
    .signal-list li.tone-caution { border-left-color: #8a6c25; }
    .signal-list li.tone-danger { border-left-color: #9b4350; }
    .signal-label { display: block; color: #edf0f7; font-weight: 700; margin-bottom: 3px; }
    .limitation { color: #9ba4b7; font-size: 12px; line-height: 1.45; margin: 10px 0 18px; }
    .metrics-title { margin-top: 18px; }
    dl { display: grid; grid-template-columns: repeat(5, minmax(90px, 1fr)); gap: 10px; margin: 16px 0; }
    dt { color: #909aad; font-size: 12px; }
    dd { margin: 3px 0 0; font-weight: 650; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .events { margin: 14px 0 0; padding-left: 20px; color: #bac2d2; }
    .empty { padding: 28px; text-align: center; color: #9ba4b7; }
    @media (max-width: 780px) {
      .controls { grid-template-columns: 1fr; }
      .toolbar { display: block; }
      .explanation-grid, .signal-list { grid-template-columns: 1fr; }
      dl { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <main>
    <section id="login-panel" class="login-card">
      <h1>Recovery admin login</h1>
      <p class="subtle">Sign in to review quarantined install mismatches.</p>
      <form id="login-form">
        <label>Username<input id="username" value="admin" readonly autocomplete="username"></label>
        <label>Password<input id="password" type="password" required autocomplete="current-password"></label>
        <button id="login" type="submit">Sign in</button>
      </form>
      <p id="login-message" class="message" role="status"></p>
    </section>

    <section id="admin-panel" class="hidden">
      <div class="toolbar">
        <div>
          <h1>Install recovery</h1>
          <p class="subtle">Credential hashes and PB payloads are never shown here.</p>
        </div>
        <button id="logout" type="button" class="secondary">Sign out</button>
      </div>
      <section class="controls" aria-label="Recovery controls">
        <label>Actor<input id="actor" value="0xSteph" maxlength="80"></label>
        <label>Status<select id="status"><option value="active">Active</option><option value="all">All</option><option value="pending">Pending</option><option value="contested">Contested</option><option value="promoted">Promoted</option><option value="rejected">Rejected</option></select></label>
        <button id="refresh" type="button">Refresh</button>
      </section>
      <p id="message" class="message" role="status"></p>
      <section id="candidates" aria-live="polite"></section>
    </section>
  </main>
  <script nonce="${nonce}">
    const loginPanel = document.querySelector('#login-panel');
    const adminPanel = document.querySelector('#admin-panel');
    const loginForm = document.querySelector('#login-form');
    const usernameInput = document.querySelector('#username');
    const passwordInput = document.querySelector('#password');
    const loginButton = document.querySelector('#login');
    const loginMessage = document.querySelector('#login-message');
    const logoutButton = document.querySelector('#logout');
    const actorInput = document.querySelector('#actor');
    const statusInput = document.querySelector('#status');
    const refreshButton = document.querySelector('#refresh');
    const message = document.querySelector('#message');
    const candidatesRoot = document.querySelector('#candidates');

    function showLogin(error) {
      adminPanel.classList.add('hidden');
      loginPanel.classList.remove('hidden');
      candidatesRoot.replaceChildren();
      loginMessage.textContent = error || '';
      passwordInput.value = '';
      passwordInput.focus();
    }

    function showAdmin() {
      loginPanel.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      loginMessage.textContent = '';
    }

    async function request(path, options) {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: {
          ...(options && options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options && options.headers ? options.headers : {})
        }
      });
      const body = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        if (response.status === 401 && path !== '/api/admin/recovery/login') {
          showLogin('Your admin session expired. Sign in again.');
        }
        throw new Error(body.error || ('Request failed (' + response.status + ')'));
      }
      return body;
    }

    function textElement(tag, value, className) {
      const node = document.createElement(tag);
      node.textContent = String(value);
      if (className) node.className = className;
      return node;
    }

    function metric(label, value) {
      const wrapper = document.createElement('div');
      wrapper.append(textElement('dt', label), textElement('dd', value));
      return wrapper;
    }

    function eventList(events) {
      const list = document.createElement('ul');
      list.className = 'events';
      for (const event of events) {
        list.append(textElement('li', event.eventType + ' by ' + event.actor + (event.reason ? ': ' + event.reason : '') + ' · ' + new Date(event.createdAt).toLocaleString()));
      }
      return list;
    }

    function insightBox(heading, title, detail, className) {
      const box = document.createElement('section');
      box.className = 'insight' + (className ? ' ' + className : '');
      box.append(
        textElement('h3', heading),
        textElement('p', title, 'insight-title'),
        textElement('p', detail)
      );
      return box;
    }

    function signalList(signals) {
      const section = document.createElement('section');
      section.className = 'signals';
      section.append(textElement('h3', 'Signals considered'));
      const list = document.createElement('ul');
      list.className = 'signal-list';
      for (const signal of signals) {
        const item = document.createElement('li');
        item.className = 'tone-' + signal.tone;
        item.append(
          textElement('span', signal.label, 'signal-label'),
          document.createTextNode(signal.detail)
        );
        list.append(item);
      }
      section.append(list);
      return section;
    }

    async function decide(candidate, decision) {
      const actor = actorInput.value.trim();
      if (!actor) throw new Error('Enter the actor responsible for this decision.');
      const reason = window.prompt('Reason for ' + decision + 'ing candidate ' + candidate.id + ':');
      if (reason === null) return;
      if (reason.trim().length < 5) throw new Error('Decision reason must be at least 5 characters.');
      if (!window.confirm(decision + ' recovery candidate ' + candidate.id + ' for ' + candidate.displayName + '?')) return;

      await request('/api/admin/recovery/candidates/' + candidate.id + '/' + decision, {
        method: 'POST',
        body: JSON.stringify({ actor: actor, reason: reason.trim() })
      });
      message.textContent = 'Candidate ' + candidate.id + ' was ' + (decision === 'promote' ? 'promoted' : 'rejected') + '.';
      await load();
    }

    function candidateCard(candidate) {
      const card = document.createElement('article');
      const head = document.createElement('div');
      head.className = 'candidate-head';
      const title = document.createElement('div');
      title.append(textElement('h2', candidate.displayName), textElement('div', 'Candidate ' + candidate.id + ' · Player ' + candidate.playerId, 'subtle'));
      head.append(title, textElement('span', candidate.status, 'badge ' + candidate.status));

      const assessment = candidate.assessment;
      const explanation = document.createElement('div');
      explanation.className = 'explanation-grid';
      explanation.append(
        insightBox('Why this is here', assessment.why.title, assessment.why.detail),
        insightBox(
          'Recommended next step',
          assessment.recommendation.title,
          assessment.recommendation.detail,
          'recommendation tone-' + assessment.recommendation.tone
        ),
        insightBox(
          'PB continuity evidence',
          assessment.continuity.title + ' · ' + assessment.continuity.coveragePercent + '% coverage',
          assessment.continuity.detail + (assessment.lastAcceptedSyncAt ? ' Previous install last accepted: ' + new Date(assessment.lastAcceptedSyncAt).toLocaleString() + '.' : '')
        ),
        insightBox('If you promote', assessment.promotionEffect.title, assessment.promotionEffect.detail)
      );

      const metrics = document.createElement('dl');
      metrics.append(
        metric('Attempts', candidate.attemptCount),
        metric('Equal', candidate.equalCount),
        metric('Improved', candidate.improvedCount),
        metric('New', candidate.newCount),
        metric('Slower', candidate.slowerCount),
        metric('Missing', candidate.missingCount),
        metric('Eligible', candidate.eligibleCount),
        metric('First seen', new Date(candidate.firstSeenAt).toLocaleString()),
        metric('Last seen', new Date(candidate.lastSeenAt).toLocaleString())
      );

      const actions = document.createElement('div');
      actions.className = 'actions';
      const promote = textElement('button', 'Promote');
      promote.type = 'button';
      promote.disabled = candidate.status !== 'pending';
      promote.addEventListener('click', function () { decide(candidate, 'promote').catch(showError); });
      const reject = textElement('button', 'Reject', 'danger');
      reject.type = 'button';
      reject.disabled = candidate.status !== 'pending' && candidate.status !== 'contested';
      reject.addEventListener('click', function () { decide(candidate, 'reject').catch(showError); });
      actions.append(promote, reject);

      card.append(
        head,
        explanation,
        signalList(assessment.signals),
        textElement('p', 'Safety limitation: ' + assessment.limitation, 'limitation'),
        textElement('h3', 'Evidence details', 'metrics-title'),
        metrics,
        actions
      );
      if (candidate.events.length) card.append(eventList(candidate.events));
      return card;
    }

    function showError(error) {
      message.textContent = error instanceof Error ? error.message : 'Unexpected error.';
    }

    async function load() {
      refreshButton.disabled = true;
      message.textContent = 'Loading…';
      try {
        const body = await request('/api/admin/recovery/candidates?status=' + encodeURIComponent(statusInput.value));
        candidatesRoot.replaceChildren(...body.candidates.map(candidateCard));
        if (!body.candidates.length) candidatesRoot.append(textElement('div', 'No matching recovery candidates.', 'empty'));
        message.textContent = 'Loaded ' + body.candidates.length + ' candidate(s).';
      } finally {
        refreshButton.disabled = false;
      }
    }

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      loginButton.disabled = true;
      loginMessage.textContent = 'Signing in…';
      try {
        await request('/api/admin/recovery/login', {
          method: 'POST',
          body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
        });
        passwordInput.value = '';
        showAdmin();
        await load();
      } catch (error) {
        showLogin(error instanceof Error ? error.message : 'Unable to sign in.');
      } finally {
        loginButton.disabled = false;
      }
    });

    logoutButton.addEventListener('click', async function () {
      try { await request('/api/admin/recovery/logout', { method: 'POST' }); }
      finally { showLogin('Signed out.'); }
    });
    refreshButton.addEventListener('click', function () { load().catch(showError); });
    statusInput.addEventListener('change', function () { load().catch(showError); });

    request('/api/admin/recovery/session')
      .then(function () { showAdmin(); return load(); })
      .catch(function () { showLogin(''); });
  </script>
</body>
</html>`;
}
