const STEPS = [
  { key: 'welcome', panel: 'intro-step', title: 'intro-title' },
  { key: 'permission', panel: 'permission-step', title: 'permission-title' },
  { key: 'discord', panel: 'discord-step', title: 'discord-title' },
  { key: 'activity', panel: 'activity-step', title: 'activity-title' },
];

/** Keep navigation deliberate: background checks update readiness, never the open panel. */
export function createSetupGuide(document) {
  const get = id => document.getElementById(id);
  const state = { scriptsAllowed: false, activityReady: false, discordConnected: false, linked: false };
  const back = get('setup-back');
  const next = get('setup-next');
  let current = 0;

  function render(focus = false) {
    const step = STEPS[current];
    const position = `Step ${current + 1} of ${STEPS.length}`;
    const complete = [false, state.scriptsAllowed, state.discordConnected || state.linked, state.activityReady];
    for (const [index, item] of STEPS.entries()) {
      const active = index === current;
      get(item.panel).hidden = !active;
      const nav = get(`setup-nav-${item.key}`);
      nav.classList.toggle('is-active', active);
      nav.classList.toggle('is-complete', complete[index]);
      if (active) nav.setAttribute('aria-current', 'step');
      else nav.removeAttribute('aria-current');
    }
    get('setup-wizard').setAttribute('data-step', step.key);
    get('setup-progress').setAttribute('aria-valuenow', String(current + 1));
    get('setup-progress').setAttribute('aria-valuetext', position);
    get('setup-position').textContent = position;
    back.hidden = current === 0;
    next.hidden = current === STEPS.length - 1;
    get('finish-setup').hidden = current !== STEPS.length - 1;
    next.disabled = step.key === 'permission' && !state.scriptsAllowed;
    next.textContent = step.key === 'welcome' ? 'Let’s get started'
      : step.key === 'discord' ? (state.discordConnected || state.linked ? 'Try your first Activity' : 'Use local preview')
        : 'Continue';
    if (focus) {
      const heading = get(step.title);
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }

  function navigate(index) {
    if (index < 0 || index >= STEPS.length || index === current) return;
    current = index;
    render(true);
  }

  for (const [index, step] of STEPS.entries()) {
    get(`setup-nav-${step.key}`).addEventListener('click', () => navigate(index));
  }
  back.addEventListener('click', () => navigate(current - 1));
  next.addEventListener('click', () => {
    if (!next.disabled) navigate(current + 1);
  });
  render();
  return {
    update(partial) {
      Object.assign(state, partial);
      render();
    },
  };
}
