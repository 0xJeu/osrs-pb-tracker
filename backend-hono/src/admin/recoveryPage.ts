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
    .installation-search { margin-top: 18px; grid-template-columns: 1fr auto; }
    #installation-results { display: grid; gap: 14px; margin-top: 14px; }
    article { padding: 16px; }
    .candidate-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
    .candidate-head h2 { margin: 0 0 4px; font-size: 19px; }
    .badge { border-radius: 999px; padding: 4px 9px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; background: #51441f; }
    .badge.promoted { background: #20553b; }
    .badge.rejected { background: #633039; }
    .badge.contested { background: #674519; }
    .badge.invalidation_pending { background: #674519; }
    .badge.invalidation_failed { background: #674519; }
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
    .installations { margin: 16px 0; padding: 14px; background: #141821; border: 1px solid #303746; border-radius: 10px; }
    .installation { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 9px 0; border-top: 1px solid #303746; }
    .installation:first-of-type { border-top: 0; }
    .events { margin: 14px 0 0; padding-left: 20px; color: #bac2d2; }
    .support { margin: 16px 0; padding: 14px; background: #141821; border: 1px solid #46536a; border-radius: 10px; }
    .support h3 { margin: 0 0 8px; font-size: 14px; }
    .support-entry { margin: 8px 0 0; padding-top: 8px; border-top: 1px solid #303746; white-space: pre-wrap; color: #d6dbea; }
    .support-time { display: block; margin-top: 4px; color: #909aad; font-size: 12px; }
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
        <label>Status<select id="status"><option value="active">Active</option><option value="all">All</option><option value="invalidation_pending">Invalidation pending</option><option value="pending">Pending</option><option value="invalidation_failed">Invalidation failed</option><option value="contested">Contested</option><option value="promoted">Promoted</option><option value="rejected">Rejected</option></select></label>
        <label>Recovery ID<input id="candidate-id" inputmode="numeric" placeholder="Exact ID"></label>
        <button id="refresh" type="button">Refresh</button>
      </section>
      <p id="message" class="message" role="status"></p>
      <section id="candidates" aria-live="polite"></section>
      <section class="controls installation-search" aria-label="Installation lookup">
        <label>Exact display name or player ID<input id="installation-query" placeholder="Player name or numeric ID"></label>
        <button id="search-installations" type="button">Find installations</button>
      </section>
      <section id="installation-results" aria-live="polite"></section>
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
    const statusInput = document.querySelector('#status');
    const candidateIdInput = document.querySelector('#candidate-id');
    const refreshButton = document.querySelector('#refresh');
    const message = document.querySelector('#message');
    const candidatesRoot = document.querySelector('#candidates');
    const installationQueryInput = document.querySelector('#installation-query');
    const searchInstallationsButton = document.querySelector('#search-installations');
    const installationResultsRoot = document.querySelector('#installation-results');

    function showLogin(error) {
      adminPanel.classList.add('hidden');
      loginPanel.classList.remove('hidden');
      candidatesRoot.replaceChildren();
      installationResultsRoot.replaceChildren();
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

    function supportList(entries) {
      const section = document.createElement('section');
      section.className = 'support';
      section.append(textElement('h3', 'Unverified player support messages'));
      section.append(textElement('p', 'Use these for context only. A message and recovery ID are not proof of account ownership.', 'subtle'));
      for (const entry of entries) {
        const wrapper = document.createElement('div');
        wrapper.className = 'support-entry';
        wrapper.append(
          document.createTextNode(entry.message),
          textElement('span', new Date(entry.createdAt).toLocaleString(), 'support-time')
        );
        section.append(wrapper);
      }
      return section;
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
      const verb = decision === 'resolve' ? 'resolving the contest for' : decision + 'ing';
      const reason = window.prompt('Reason for ' + verb + ' candidate ' + candidate.id + ':');
      if (reason === null) return;
      if (reason.trim().length < 5) throw new Error('Decision reason must be at least 5 characters.');
      const warning = decision === 'resolve'
        ? 'Resolve candidate ' + candidate.id + ' for ' + candidate.displayName + ' and reject every competing active candidate? This does not promote or change the current credential.'
        : decision === 'replace'
        ? 'REPLACE ALL authorized installations for ' + candidate.displayName + '? Existing machines will stop syncing. Use this only for a confirmed security recovery.'
        : decision === 'promote'
        ? 'Authorize candidate ' + candidate.id + ' as an additional installation for ' + candidate.displayName + '? Existing installations remain active and no quarantined PB payload is applied.'
        : decision === 'reopen'
        ? 'Reopen rejected candidate ' + candidate.id + '? This does not authorize it; the candidate returns to pending or contested review.'
        : decision + ' recovery candidate ' + candidate.id + ' for ' + candidate.displayName + '?';
      if (!window.confirm(warning)) return;

      await request('/api/admin/recovery/candidates/' + candidate.id + '/' + decision, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      message.textContent = decision === 'resolve'
        ? 'Candidate ' + candidate.id + ' contest was resolved. Review it again before authorization.'
        : decision === 'reopen'
        ? 'Candidate ' + candidate.id + ' was reopened for review.'
        : 'Candidate ' + candidate.id + ' was ' + (decision === 'promote' ? 'promoted' : 'rejected') + '.';
      await load();
    }

    async function decideInstallation(installation, decision) {
      const reason = window.prompt('Reason for ' + decision + ' installation ' + installation.id + ':');
      if (reason === null) return;
      if (reason.trim().length < 5) throw new Error('Decision reason must be at least 5 characters.');
      if (!window.confirm((decision === 'revoke' ? 'Revoke' : 'Reactivate') + ' installation ' + installation.id + '?')) return;
      await request('/api/admin/recovery/installations/' + installation.id + '/' + decision, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      message.textContent = 'Installation ' + installation.id + ' was ' + (decision === 'revoke' ? 'revoked' : 'reactivated') + '.';
      await load();
      if (installationQueryInput.value.trim()) await loadInstallations();
    }

    function installationList(candidate) {
      const section = document.createElement('section');
      section.className = 'installations';
      section.append(textElement('h3', 'Installation records (' + candidate.activeInstallCount + ' active)'));
      for (const installation of candidate.installations) {
        const row = document.createElement('div');
        row.className = 'installation';
        row.append(textElement('div', 'Installation ' + installation.id + ' · ' + installation.status + ' · last database-observed ' + new Date(installation.lastSeenAt).toLocaleString(), 'subtle'));
        const action = textElement('button', installation.status === 'active' ? 'Revoke installation' : 'Reactivate installation', installation.status === 'active' ? 'danger' : 'secondary');
        action.type = 'button';
        action.disabled = installation.status === 'active' && candidate.activeInstallCount <= 1;
        action.addEventListener('click', function () { decideInstallation(installation, installation.status === 'active' ? 'revoke' : 'reactivate').catch(showError); });
        row.append(action);
        section.append(row);
      }
      return section;
    }

    function candidateCard(candidate) {
      const card = document.createElement('article');
      const head = document.createElement('div');
      head.className = 'candidate-head';
      const title = document.createElement('div');
      title.append(textElement('h2', candidate.displayName), textElement('div', 'Candidate ' + candidate.id + ' · Player ' + candidate.playerId + ' · ' + candidate.assessment.lane + ' lane', 'subtle'));
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
          assessment.continuity.detail + (assessment.lastAcceptedSyncAt ? ' Last database-recorded accepted change: ' + new Date(assessment.lastAcceptedSyncAt).toLocaleString() + '.' : '')
        ),
        insightBox('If you approve', assessment.promotionEffect.title, assessment.promotionEffect.detail)
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
        metric('Active installs', candidate.activeInstallCount),
        metric('First seen', new Date(candidate.firstSeenAt).toLocaleString()),
        metric('Last seen', new Date(candidate.lastSeenAt).toLocaleString())
      );

      const actions = document.createElement('div');
      actions.className = 'actions';
      const promote = textElement('button', 'Authorize additional install');
      promote.type = 'button';
      promote.disabled = candidate.status !== 'pending';
      promote.addEventListener('click', function () { decide(candidate, 'promote').catch(showError); });
      const replace = textElement('button', 'Replace all installs', 'danger');
      replace.type = 'button';
      replace.disabled = candidate.status !== 'pending';
      replace.addEventListener('click', function () { decide(candidate, 'replace').catch(showError); });
      const reject = textElement('button', 'Reject', 'danger');
      reject.type = 'button';
      reject.disabled = candidate.status !== 'invalidation_pending' && candidate.status !== 'pending' && candidate.status !== 'invalidation_failed' && candidate.status !== 'contested';
      reject.addEventListener('click', function () { decide(candidate, 'reject').catch(showError); });
      const resolve = textElement('button', 'Resolve contest', 'secondary');
      resolve.type = 'button';
      resolve.disabled = candidate.status !== 'contested';
      resolve.addEventListener('click', function () { decide(candidate, 'resolve').catch(showError); });
      const reopen = textElement('button', 'Reopen candidate', 'secondary');
      reopen.type = 'button';
      reopen.disabled = candidate.status !== 'rejected' && candidate.status !== 'invalidation_pending' && candidate.status !== 'invalidation_failed';
      reopen.addEventListener('click', function () { decide(candidate, 'reopen').catch(showError); });
      actions.append(promote, resolve, reject, reopen, replace);

      card.append(
        head,
        explanation,
        signalList(assessment.signals),
        textElement('p', 'Safety limitation: ' + assessment.limitation, 'limitation'),
        textElement('h3', 'Evidence details', 'metrics-title'),
        metrics,
        ...(candidate.supportMessages.length ? [supportList(candidate.supportMessages)] : []),
        actions,
        installationList(candidate)
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
        const candidateId = candidateIdInput.value.trim();
        if (candidateId && !/^[1-9]\\d*$/.test(candidateId)) throw new Error('Recovery ID must be a positive integer.');
        const body = await request('/api/admin/recovery/candidates?status=' + encodeURIComponent(statusInput.value) + (candidateId ? '&id=' + encodeURIComponent(candidateId) : ''));
        candidatesRoot.replaceChildren(...body.candidates.map(candidateCard));
        if (!body.candidates.length) candidatesRoot.append(textElement('div', 'No matching recovery candidates.', 'empty'));
        message.textContent = 'Loaded ' + body.candidates.length + ' candidate(s).';
      } finally {
        refreshButton.disabled = false;
      }
    }

    async function loadInstallations() {
      const query = installationQueryInput.value.trim();
      if (!query) throw new Error('Enter an exact display name or player ID.');
      searchInstallationsButton.disabled = true;
      message.textContent = 'Finding installation records…';
      try {
        const parameter = /^[1-9]\\d*$/.test(query) ? 'playerId' : 'displayName';
        const body = await request('/api/admin/recovery/installations?' + parameter + '=' + encodeURIComponent(query));
        const groups = body.players.map(function (player) {
          const card = document.createElement('article');
          card.append(
            textElement('h2', player.displayName),
            textElement('div', 'Player ' + player.playerId, 'subtle'),
            installationList(player)
          );
          return card;
        });
        installationResultsRoot.replaceChildren(...groups);
        if (!groups.length) installationResultsRoot.append(textElement('div', 'No exact player match.', 'empty'));
        message.textContent = 'Found ' + groups.length + ' matching player(s).';
      } finally {
        searchInstallationsButton.disabled = false;
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
    candidateIdInput.addEventListener('change', function () { load().catch(showError); });
    searchInstallationsButton.addEventListener('click', function () { loadInstallations().catch(showError); });
    installationQueryInput.addEventListener('change', function () { loadInstallations().catch(showError); });

    request('/api/admin/recovery/session')
      .then(function () { showAdmin(); return load(); })
      .catch(function () { showLogin(''); });
  </script>
</body>
</html>`;
}
