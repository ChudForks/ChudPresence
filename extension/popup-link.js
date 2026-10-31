const DISPLAY_LABELS = { app: 'Application name', creator: 'Creator / artist', title: 'Title' };
const FIELD_LABELS = { display: 'Discord bar display', enabled: 'Service enabled', showWhilePaused: 'Show while paused',
  artwork: 'Artwork', playbackProgress: 'Playback progress', actionButtons: 'Action buttons' };

export function createPopupLink({ document, api, onChange = () => {} }) {
  const element = id => document.getElementById(id);
  const selections = new Map();
  let busy = false;
  let serviceSignature = '';
  let revision = 0;
  let state = {};

  function feedback(text, error = false) {
    element('link-feedback').textContent = text;
    element('link-feedback').classList.toggle('is-error', error);
  }

  async function send(type, value = {}) {
    const response = await api.runtime.sendMessage({ type, ...value });
    if (!response?.ok) throw new Error(response?.error || 'Could not reach ChudPresence Link.');
    return response.result;
  }

  function renderServices() {
    const signature = JSON.stringify({ connected: state.connected, services: state.services || [] });
    if (signature === serviceSignature) return;
    serviceSignature = signature;
    const container = element('link-services');
    container.replaceChildren();
    if (!state.services?.length) {
      const empty = document.createElement('p');
      empty.className = 'link-card link-help';
      empty.textContent = 'Install an Activity to discover services. Pair a phone in Link to find shared services.';
      container.append(empty);
    }
    for (const service of state.services || []) {
      const card = document.createElement('section');
      card.className = 'link-card link-service';
      const heading = document.createElement('div');
      heading.className = 'link-service-heading';
      const name = document.createElement('strong');
      name.textContent = service.name;
      const badge = document.createElement('span');
      badge.className = 'link-service-state';
      const supported = service.supportedFields || (service.displayChoices.length ? ['display'] : []);
      const requested = service.syncRequested ?? service.syncEnabled;
      const active = service.syncActive ?? (service.shared && service.syncEnabled && supported.length > 0);
      badge.textContent = requested ? active ? 'Sync on' : 'Sync paused' : 'Local';
      heading.append(name, badge);
      const help = document.createElement('p');
      help.className = 'link-help';
      help.textContent = requested && !active ? 'Sync is paused because a device or selected setting is unavailable. Choose compatible settings to resume, or disable sync.'
        : !service.shared ? 'Pair a phone that supports this service to sync its settings.'
          : !supported.length ? 'These devices have no compatible settings.'
            : requested ? `Syncing: ${(service.syncFields || ['display']).map(field => FIELD_LABELS[field]).join(', ')}.`
              : 'Choose settings and a starting device, then enable sync.';
      card.append(heading, help);
      const actions = document.createElement('div');
      actions.className = 'link-service-actions';
      if (service.shared && supported.length) {
        const saved = selections.get(service.id);
        const fields = saved?.version === service.syncVersion ? saved.fields
          : requested ? (service.syncFields || ['display']).filter(field => supported.includes(field)) : [...supported];
        let mode;
        const choices = [];
        if (state.selectiveSettings && supported.length > 1) {
          const modeLabel = document.createElement('label');
          modeLabel.className = 'link-field';
          modeLabel.append('Settings to sync');
          mode = document.createElement('select');
          mode.setAttribute('aria-label', `Settings to sync for ${service.name}`);
          for (const [value, text] of [['all', 'All supported settings'], ['selected', 'Selected settings']]) {
            const option = document.createElement('option');
            option.value = value; option.textContent = text; mode.append(option);
          }
          mode.value = saved?.version === service.syncVersion ? saved.mode : fields.length === supported.length ? 'all' : 'selected';
          modeLabel.append(mode); card.append(modeLabel);
        }
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'link-sync-fields';
        const legend = document.createElement('legend');
        legend.textContent = 'Selected settings'; fieldset.append(legend);
        for (const field of supported) {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox'; input.value = field; input.checked = fields.includes(field);
          input.setAttribute('aria-label', `Sync ${FIELD_LABELS[field].toLowerCase()} for ${service.name}`);
          label.append(input, FIELD_LABELS[field]); fieldset.append(label); choices.push(input);
        }
        fieldset.hidden = !mode || mode.value === 'all';
        card.append(fieldset);
        const label = document.createElement('label');
        label.className = 'link-field';
        label.append('Start with');
        const source = document.createElement('select');
        source.setAttribute('aria-label', `Starting setting for ${service.name}`);
        label.append(source);
        card.append(label);
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'small-action';
        action.textContent = requested ? 'Save sync settings' : 'Enable sync';
        action.setAttribute('aria-label', `${action.textContent} for ${service.name}`);
        const selectedFields = () => !mode || mode.value === 'selected' ? choices.filter(input => input.checked).map(input => input.value) : [...supported];
        function remember() {
          selections.set(service.id, { version: service.syncVersion, mode: mode?.value || 'selected',
            fields: choices.filter(input => input.checked).map(input => input.value), source: source.value });
        }
        function updateSources() {
          const selected = selectedFields();
          const preferred = source.value || saved?.source || `device:${state.deviceId}`;
          source.replaceChildren();
          for (const peer of service.participants || []) {
            if (!selected.length || !selected.every(field => field === 'display' ? service.displayChoices.includes(peer.display) : typeof peer[field] === 'boolean')) continue;
            const option = document.createElement('option');
            option.value = `device:${peer.deviceId}`;
            option.textContent = `${peer.deviceId === state.deviceId ? 'This browser' : peer.name}${selected.length === 1 && selected[0] === 'display' ? ` · ${DISPLAY_LABELS[peer.display]}` : ' · last reported settings'}`;
            source.append(option);
          }
          if (selected.length === 1 && selected[0] === 'display') {
            for (const display of service.displayChoices) {
              const option = document.createElement('option');
              option.value = `display:${display}`; option.textContent = DISPLAY_LABELS[display]; source.append(option);
            }
          }
          if ([...source.options].some(option => option.value === preferred)) source.value = preferred;
          source.disabled = busy || !state.connected || !source.options.length;
          action.disabled = busy || !state.connected || !selected.length || !source.options.length;
          fieldset.hidden = !mode || mode.value === 'all';
        }
        mode?.addEventListener('change', () => { updateSources(); remember(); });
        for (const input of choices) input.addEventListener('change', () => { updateSources(); remember(); });
        source.addEventListener('change', remember);
        updateSources();
        action.addEventListener('click', () => run(async () => {
          const selected = source.value || '';
          const selection = { id: service.id, enabled: true, baseVersion: service.syncVersion,
            ...(state.selectiveSettings ? { fields: selectedFields() } : {}),
            ...(selected.startsWith('device:') ? { sourceDeviceId: selected.slice(7) }
              : selected.startsWith('display:') ? { initialDisplay: selected.slice(8) } : {}) };
          render(await send('LINK_SET_SYNC', { selection }));
          feedback(requested ? 'Sync settings updated.' : 'Sync enabled.');
        }));
        actions.append(action);
      }
      if (requested) {
        const disable = document.createElement('button');
        disable.type = 'button'; disable.className = 'text-button'; disable.textContent = 'Disable sync';
        disable.setAttribute('aria-label', `Disable sync for ${service.name}`);
        disable.disabled = busy || !state.connected;
        disable.addEventListener('click', () => run(async () => {
          render(await send('LINK_SET_SYNC', { selection: { id: service.id, enabled: false, baseVersion: service.syncVersion } }));
          feedback('Sync disabled. Your current settings stay local.');
        }));
        actions.append(disable);
      }
      card.append(actions);
      container.append(card);
    }
  }

  function render(value = {}) {
    state = value;
    const paired = state.paired && !state.needsPairing;
    element('link-view').dataset.paired = String(Boolean(paired));
    element('link-pair-form').hidden = paired;
    element('link-paired-actions').hidden = !state.paired;
    element('link-services-section').hidden = !paired;
    element('link-badge').textContent = state.needsPairing ? 'Pair again' : state.connected ? 'Connected' : state.paired ? 'Offline' : 'Unlinked';
    element('link-badge').classList.toggle('is-connected', state.connected === true);
    element('link-connection-title').textContent = paired ? state.deviceName : 'Connect your devices';
    element('link-message').textContent = state.message || 'Pair with the Link app on this PC.';
    element('link-transport').textContent = state.transport === 'local' ? state.published ? 'Local Discord · publishing'
      : state.hasPresence === false ? 'Local Discord · ready' : 'Local Discord · accepted'
      : state.transport === 'waiting' ? state.recovery === 'startup' ? `Previous session · ${state.fallbackSeconds}s`
        : `Resuming presence in ${state.fallbackSeconds}s`
        : state.transport === 'idle' ? 'Waiting for activity' : 'Headless session';
    element('link-presence-help').textContent = state.transport === 'idle'
      ? 'Link is connected. Local Discord starts when an Activity can be shared.'
      : state.transport === 'waiting' && state.recovery === 'startup'
        ? 'Waiting for the previous local session to clear safely before resuming presence.'
        : state.transport === 'local' && state.hasPresence !== false && !state.published
          ? 'Link accepted the activity. Waiting for confirmation that Discord is publishing it.'
          : state.publishingMessage || 'Link uses your local Discord app while connected. Headless presence resumes automatically when Link is unavailable.';
    if (state.paired && state.port && document.activeElement !== element('link-port')) element('link-port').value = String(state.port);
    renderServices();
    if (state.conflict) feedback(state.conflict);
    else if (state.pendingChanges) feedback(`Settings for ${state.pendingChanges} service${state.pendingChanges === 1 ? '' : 's'} waiting to sync.`);
  }

  async function run(operation) {
    if (busy) return;
    busy = true;
    revision++;
    feedback('Connecting…');
    for (const button of document.querySelectorAll('#link-view button')) button.disabled = true;
    try { await operation(); onChange(); }
    catch (error) { feedback(error.message, true); }
    finally {
      busy = false;
      for (const button of document.querySelectorAll('#link-view button')) button.disabled = false;
      serviceSignature = '';
      renderServices();
    }
  }

  element('link-pair-form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      render(await send('LINK_PAIR', { pairing: { code: element('link-code').value.trim(),
        name: element('link-device-name').value.trim(), port: Number(element('link-port').value) } }));
      element('link-code').value = '';
      feedback('Browser paired. Choose any shared services you want to sync.');
    });
  });
  element('link-refresh').addEventListener('click', () => run(async () => { render(await send('LINK_REFRESH')); feedback('Connection refreshed.'); }));
  element('link-unpair').addEventListener('click', () => run(async () => { render(await send('LINK_UNPAIR')); feedback('Browser unlinked.'); }));

  return Object.freeze({ render, async refresh() {
    if (busy) return;
    const started = revision;
    try {
      const result = await send('LINK_REFRESH');
      if (!busy && revision === started) render(result);
    } catch (error) { if (!busy && revision === started) feedback(error.message, true); }
  } });
}
