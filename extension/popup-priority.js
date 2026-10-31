import { DEFAULT_ACTIVITY_PRIORITY_RULES, MAX_ACTIVITY_PRIORITY_RULES, normalizeActivityPriorityRules } from './core/activity-priority.js';

const stateNames = { any: 'Any state', playing: 'Playing media', browsing: 'Browsing / page activity', paused: 'Paused media' };
const scopeNames = { any: 'Any tab', viewed: 'Viewed tab', background: 'Other tabs' };

export function createPopupPriorityEditor({ document, sendMessage, onApplied = () => {} }) {
  const card = document.getElementById('priority-card');
  const list = document.getElementById('priority-list');
  const status = document.getElementById('priority-status');
  const add = document.getElementById('priority-add');
  const reset = document.getElementById('priority-reset');
  const retry = document.getElementById('priority-retry');
  let rules = normalizeActivityPriorityRules();
  let installed = [];
  let revision = 0;
  let loaded = false;
  let saving = false;
  let dirty = false;
  let editingId = '';
  let draggedId = '';
  let renderKey = '';

  function node(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function feedback(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
    retry.hidden = !error;
  }

  function clearDrag() {
    draggedId = '';
    for (const row of list.children) {
      row.classList.remove('is-dragging', 'drop-before', 'drop-after');
    }
  }

  function render(focusId = '', focusPart = '') {
    add.disabled = !loaded || saving || rules.length >= MAX_ACTIVITY_PRIORITY_RULES;
    reset.disabled = !loaded || saving;
    retry.disabled = saving;
    card.setAttribute('aria-busy', String(saving));
    document.getElementById('priority-summary').textContent = loaded
      ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} · drag to reorder` : 'Loading priorities…';
    const key = JSON.stringify([rules, installed.map(activity => [activity.id, activity.name]), loaded, saving, editingId]);
    if (key === renderKey) return;
    renderKey = key;
    const active = document.activeElement;
    focusId ||= active?.closest('.priority-rule')?.dataset.ruleId || '';
    focusPart ||= active?.dataset.priorityControl || '';
    const rows = rules.map((rule, index) => {
      const row = node('li', 'priority-rule');
      row.dataset.ruleId = rule.id;
      const heading = node('div', 'priority-rule-heading');
      const handle = node('button', 'priority-handle', '⠿');
      handle.type = 'button';
      handle.draggable = loaded && !saving;
      handle.disabled = !loaded || saving;
      handle.dataset.priorityControl = 'handle';
      handle.setAttribute('aria-label', `Move priority ${index + 1}. Drag or use the up and down arrow keys.`);
      handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
      handle.title = 'Drag to reorder · ↑ / ↓ to move';
      handle.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        return move(rule.id, index + (event.key === 'ArrowUp' ? -1 : 1));
      });
      handle.addEventListener('dragstart', event => {
        if (!loaded || saving) { event.preventDefault(); return; }
        draggedId = rule.id;
        row.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', rule.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      handle.addEventListener('dragend', clearDrag);
      const copy = node('span', 'priority-rule-copy');
      const name = installed.find(activity => activity.id === rule.activityId)?.name || rule.activityId;
      copy.append(node('strong', '', rule.activityId ? name : rule.state === 'any' ? 'Any Activity' : stateNames[rule.state]),
        node('small', '', `${rule.activityId ? stateNames[rule.state] + ' · ' : ''}${scopeNames[rule.scope]}`));
      const edit = node('button', 'priority-edit', '⋯');
      edit.type = 'button';
      edit.disabled = !loaded || saving;
      edit.dataset.priorityControl = 'edit';
      edit.setAttribute('aria-label', `Edit priority ${index + 1}`);
      edit.setAttribute('aria-expanded', String(editingId === rule.id));
      edit.addEventListener('click', () => {
        editingId = editingId === rule.id ? '' : rule.id;
        render(rule.id, 'edit');
      });
      heading.append(handle, node('span', 'priority-number', String(index + 1)), copy, edit);
      const fields = node('div', 'priority-rule-fields');
      fields.hidden = editingId !== rule.id;
      const activities = [['', 'Any Activity'], ...installed.map(activity => [activity.id, activity.name])];
      if (rule.activityId && !installed.some(activity => activity.id === rule.activityId)) {
        activities.push([rule.activityId, `${rule.activityId} (not installed)`]);
      }
      for (const [field, label, options] of [
        ['activityId', 'Activity', activities], ['state', 'State', Object.entries(stateNames)], ['scope', 'Tab', Object.entries(scopeNames)],
      ]) {
        const wrapper = node('label', 'priority-field');
        const select = node('select', `priority-${field}`);
        select.dataset.priorityControl = field;
        select.disabled = !loaded || saving;
        select.setAttribute('aria-label', `${label} for priority ${index + 1}`);
        for (const [value, text] of options) {
          const option = node('option', '', text);
          option.value = value;
          select.append(option);
        }
        select.value = rule[field];
        select.addEventListener('change', () => commit(rules.map(current =>
          current.id === rule.id ? { ...current, [field]: select.value } : current), rule.id, field));
        wrapper.append(node('span', '', label), select);
        fields.append(wrapper);
      }
      const remove = node('button', 'text-button priority-remove', 'Remove rule');
      remove.type = 'button';
      remove.disabled = !loaded || saving;
      remove.addEventListener('click', () => commit(rules.filter(current => current.id !== rule.id),
        rules[index + 1]?.id || rules[index - 1]?.id, 'handle'));
      fields.append(remove);
      row.append(heading, fields);
      row.addEventListener('dragover', event => {
        if (!draggedId || saving || draggedId === rule.id) return;
        event.preventDefault();
        for (const other of list.children) other.classList.remove('drop-before', 'drop-after');
        row.classList.add(rules.findIndex(current => current.id === draggedId) < index ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('drop', event => {
        event.preventDefault();
        const sourceId = draggedId;
        clearDrag();
        if (sourceId) return move(sourceId, index);
      });
      return row;
    });
    list.replaceChildren(...rows);
    if (!saving && focusId && focusPart) {
      rows.find(row => row.dataset.ruleId === focusId)?.querySelector(`.priority-${focusPart}`)?.focus({ preventScroll: true });
    }
  }

  async function commit(next, focusId = '', focusPart = '') {
    if (!loaded || saving) return;
    rules = next;
    revision++;
    dirty = true;
    saving = true;
    feedback('Saving…');
    render();
    try {
      const result = await sendMessage({ type: 'ACTIVITY_SET_PRIORITY', rules });
      revision++;
      rules = normalizeActivityPriorityRules(result.priorityRules);
      dirty = false;
      feedback('Saved automatically');
      onApplied(result);
    } catch (error) {
      feedback(error.message || 'Could not save priority. Retry your changes.', true);
    } finally {
      saving = false;
      render(focusId, focusPart);
      if (!rules.length) add.focus({ preventScroll: true });
    }
  }

  function move(id, target) {
    const index = rules.findIndex(rule => rule.id === id);
    if (index < 0 || index === target || target < 0 || target >= rules.length) return;
    const next = rules.slice();
    next.splice(target, 0, ...next.splice(index, 1));
    return commit(next, id, 'handle');
  }

  add.addEventListener('click', () => {
    if (rules.length >= MAX_ACTIVITY_PRIORITY_RULES) return;
    const rule = { id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      activityId: installed[0]?.id || '', state: 'playing', scope: 'any' };
    editingId = rule.id;
    return commit([rule, ...rules], rule.id, 'activityId');
  });
  reset.addEventListener('click', () => {
    editingId = '';
    return commit(DEFAULT_ACTIVITY_PRIORITY_RULES.map(rule => ({ ...rule })));
  });
  retry.addEventListener('click', () => commit(rules));
  card.addEventListener('toggle', () => {
    if (card.open) card.scrollIntoView?.({ block: 'nearest' });
  });
  render();
  return {
    get revision() { return revision; },
    update(state, requestedRevision = revision) {
      if (Array.isArray(state.installed)) installed = state.installed;
      if (Object.hasOwn(state, 'priorityRules') && requestedRevision === revision && !saving && !dirty) {
        rules = normalizeActivityPriorityRules(state.priorityRules);
        loaded = true;
      }
      render();
    },
  };
}
