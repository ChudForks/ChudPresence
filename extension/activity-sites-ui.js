import { activitySiteFromPage, activitySitePattern, normalizeActivitySite } from './core/activity-sites.js';
import { requestHostPermissions } from './core/activity-permissions.js';

export function renderActivitySites({ document, activity, api, sendMessage, onChanged, onError, currentTab, allowManual = true }) {
  if (activity.siteAccess !== 'user-configured' || activity.apiVersion !== 1) return null;
  const create = (tag, className, text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const section = create('div', 'activity-sites');
  section.append(create('strong', '', `${activity.name} servers`),
    create('p', 'activity-sites-help', 'Only the servers you add are checked, while this Activity is enabled.'));
  const feedback = create('p', 'activity-sites-feedback');
  feedback.setAttribute('role', 'status');
  const perform = async (button, site, remove = false) => {
    button.disabled = true;
    feedback.textContent = '';
    try {
      if (!remove) {
        // The browser may close the popup while its permission prompt is open.
        // Record the server first so the background finishes setup on grant.
        // Neither call is awaited before the request, keeping the user gesture.
        let remembered;
        try { remembered = Promise.resolve(sendMessage({ type: 'ACTIVITY_PENDING_SITE', id: activity.id, site })).catch(() => {}); }
        catch { remembered = Promise.resolve(); }
        const network = Array.isArray(activity.network) ? activity.network : [];
        const granted = await requestHostPermissions([...new Set([activitySitePattern(site), ...network])], api);
        await remembered;
        if (!granted) {
          await Promise.resolve(sendMessage({ type: 'ACTIVITY_PENDING_SITE', id: activity.id, site, cancel: true })).catch(() => {});
          throw new Error('Server access was not granted. No server was added.');
        }
      }
      await sendMessage({ type: remove ? 'ACTIVITY_REMOVE_SITE' : 'ACTIVITY_ADD_SITE', id: activity.id, site });
      await onChanged();
    } catch (error) {
      feedback.textContent = error.message || 'Could not update this server.';
      onError?.(error);
    } finally { button.disabled = false; }
  };
  let currentSite = '';
  try { if (currentTab?.url) currentSite = activitySiteFromPage(currentTab.url); } catch {}
  if (currentSite) {
    const exists = (activity.sites || []).includes(currentSite);
    const restore = exists && activity.status === 'permission-missing';
    const button = create('button', 'button secondary activity-site-current', restore
      ? `Restore ${activity.name} access on this site` : exists
      ? `${activity.name} is set up on this site` : `Enable ${activity.name} on this site`);
    button.type = 'button';
    button.disabled = (exists && !restore) || !activity.enabled;
    button.title = currentSite;
    button.addEventListener('click', () => perform(button, currentSite));
    section.append(button);
  }
  if (allowManual) {
    const form = create('div', 'activity-site-form');
    const input = create('input', 'activity-site-input');
    input.type = 'url';
    input.placeholder = 'https://media.example.com/';
    input.setAttribute('aria-label', `${activity.name} server URL`);
    input.autocomplete = 'off';
    const add = create('button', 'button secondary activity-site-add', 'Add server');
    add.type = 'button';
    add.addEventListener('click', () => {
      try {
        const url = new URL(input.value.trim());
        const site = /\/web(?:\/|$)/i.test(url.pathname) ? activitySiteFromPage(url.href) : normalizeActivitySite(url.href);
        return perform(add, site);
      } catch (error) { feedback.textContent = error.message || 'Enter a complete server URL.'; }
    });
    form.append(input, add);
    section.append(form);
  }
  const list = create('ul', 'activity-site-list');
  for (const site of activity.sites || []) {
    const row = create('li', 'activity-site-row');
    const remove = create('button', 'button secondary activity-site-remove', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${site}`);
    remove.addEventListener('click', () => perform(remove, site, true));
    row.append(create('span', 'activity-site-url', site), remove);
    list.append(row);
  }
  if (!list.children.length) section.append(create('p', 'activity-sites-help', 'No servers added yet.'));
  section.append(list, feedback);
  return section;
}
