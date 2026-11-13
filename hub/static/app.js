'use strict';

const $ = (id) => document.getElementById(id);
let key = sessionStorage.getItem('yag_hub_admin_key') || '';
let active = false;
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const bytes = (value) => {
  if (value === null || value === undefined) return 'Unavailable';
  if (!Number.isFinite(Number(value))) return 'Unavailable';
  return (Number(value) / (1024 ** 3)).toFixed(2) + ' GiB';
};
const notify = (message) => { $('banner').textContent = message || ''; };
const button = (name, onClick, danger = false) => {
  const control = el('button', name, danger ? 'danger' : 'ghost');
  control.type = 'button';
  control.addEventListener('click', () => {
    control.disabled = true;
    Promise.resolve().then(onClick).catch(e => notify(e.message)).finally(() => { control.disabled = false; });
  });
  return control;
};
async function request(path, options = {}) {
  const headers = {Authorization: 'Bearer ' + key, ...options.headers};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {...options, headers, cache: 'no-store'});
  if (!response.ok) {
    let error = 'HTTP ' + response.status;
    try { error = (await response.json()).error?.message || error; } catch { /* non-JSON error */ }
    throw new Error(error);
  }
  return response;
}
const json = async (path, options = {}) => (await request(path, options)).json();
const mutate = async (path, method, body) => json(path, {
  method, ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});
const textline = (name, description, controls = []) => {
  const item = el('div', null, 'item');
  const body = el('div');
  body.append(el('div', name, 'name'), el('small', description));
  const tools = el('div', null, 'tools');
  controls.forEach(control => tools.append(control));
  item.append(body, tools);
  return item;
};
function displayStats(summary, clients, nodes) {
  const hardware = summary.hardware || {};
  const stats = [
    ['ACTIVE REQUESTS', summary.scheduler?.active ?? '—', 'Concurrent inference'],
    ['IN QUEUE', summary.scheduler?.queued ?? '—', 'Waiting for a slot'],
    ['CLIENTS', clients.filter(c => c.enabled).length, 'Currently enabled'],
    ['EXTRA NODES', nodes.filter(n => n.enabled).length, 'Configured and enabled'],
  ];
  $('stats').replaceChildren(...stats.map(([label, count, detail]) => {
    const box = el('div', null, 'stat');
    box.append(el('span', label), el('strong', count), el('small', detail));
    return box;
  }));
  const hardwareLines = [
    ['Host CPU', hardware.cpu_percent == null ? 'Collecting…' : hardware.cpu_percent + '%'],
    ['Host RAM available', bytes(hardware.memory_available_bytes) + ' / ' + bytes(hardware.memory_total_bytes)],
    ['Ollama allocated VRAM', bytes(hardware.ollama_size_vram_bytes)],
    ['GPU utilization', 'Not reported by runtime'],
    ['Scheduler', (summary.scheduler?.active ?? 0) + ' / ' + (summary.scheduler?.max_active ?? 0) + ' active, ' +
      (summary.scheduler?.queued ?? 0) + ' waiting'],
  ];
  for (const model of hardware.loaded_models || [])
    hardwareLines.push(['Loaded: ' + model.name, bytes(model.size_vram) + ' VRAM allocation']);
  $('hardware').replaceChildren(...hardwareLines.map(([name, value]) => textline(name, value)));
}
async function loadClients() {
  const data = await json('/hub/api/clients');
  $('clients').replaceChildren(...data.data.map(client => {
    const change = async (changes) => {
      await mutate('/hub/api/clients/' + client.id, 'PATCH', changes);
      await loadClients();
    };
    const controls = [
      button(client.enabled ? 'Disable' : 'Enable', () => change({enabled: !client.enabled})),
      button('Rename', async () => {
        const name = window.prompt('New device name', client.name);
        if (name !== null && name.trim()) await change({name: name.trim()});
      }),
      button('Priority ' + client.priority, async () => {
        const raw = window.prompt('Scheduling priority: 0 (low), 1 (normal), 2 (high)', client.priority);
        if (raw !== null && /^[012]$/.test(raw)) await change({priority: Number(raw)});
      }),
      button('Parallel ' + client.max_parallel, async () => {
        const raw = window.prompt('Maximum concurrent inference requests: 1..8', client.max_parallel);
        if (raw !== null && /^[1-8]$/.test(raw)) await change({max_parallel: Number(raw)});
      }),
      button('Revoke', async () => {
        if (!window.confirm('Revoke ' + client.name + '? This API key will stop working immediately for NEW requests.'))
          return;
        await mutate('/hub/api/clients/' + client.id, 'DELETE');
        await loadClients();
      }, true),
    ];
    return textline(client.name, client.scope + ' · accepted ' + client.accepted +
      ' · rejected ' + client.rejected + (client.enabled ? '' : ' · DISABLED'), controls);
  }));
  return data.data;
}
async function loadNodes() {
  const data = await json('/hub/api/nodes');
  $('nodes').replaceChildren(...data.data.map(node => {
    const change = async (body) => {
      await mutate('/hub/api/nodes/' + node.id, 'PATCH', body);
      await loadNodes();
    };
    return textline(node.name, node.url + ' · ' + node.models.join(', ') + (node.enabled ? '' : ' · DISABLED'), [
      button(node.enabled ? 'Disable' : 'Enable', () => change({enabled: !node.enabled})),
      button('Models', async () => {
        const raw = window.prompt('Comma-separated exact model IDs', node.models.join(', '));
        if (raw !== null) await change({models: raw.split(',').map(v => v.trim()).filter(Boolean)});
      }),
      button('Remove', async () => {
        if (!window.confirm('Remove node ' + node.name + '?')) return;
        await mutate('/hub/api/nodes/' + node.id, 'DELETE');
        await loadNodes();
      }, true),
    ]);
  }));
  return data.data;
}
async function loadModels() {
  const data = await json('/hub/api/models');
  const models = Array.isArray(data.models) ? data.models : [];
  $('models').replaceChildren(...models.map(model => {
    const name = model.name || model.model;
    return textline(name, bytes(model.size) + ' · ' + (model.details?.parameter_size || 'Installed'), [
      button('Delete', async () => {
        if (!window.confirm('Permanently delete model ' + name + ' from the central Ollama host?')) return;
        await mutate('/hub/api/models/delete', 'POST', {model: name});
        notify('Deleted: ' + name);
        await loadModels();
      }, true),
    ]);
  }));
  if (!models.length) $('models').append(el('p', 'No models installed or Ollama not reachable.', 'placeholder'));
}
async function loadJobs() {
  const data = await json('/hub/api/jobs');
  $('jobs').textContent = (data.data || []).slice(-3).map(
    job => job.model + ': ' + job.status + (job.error ? ' (' + job.error + ')' : '')).join(' · ');
}
async function refresh() {
  if (!key || !active) return;
  const parts = await Promise.allSettled([
    json('/hub/api/summary'), loadClients(), loadNodes(), loadModels(), loadJobs(),
  ]);
  if (parts[0].status === 'fulfilled' && parts[1].status === 'fulfilled' && parts[2].status === 'fulfilled')
    displayStats(parts[0].value, parts[1].value, parts[2].value);
  const failures = parts.filter(p => p.status === 'rejected');
  if (failures.length) notify(failures[0].reason.message);
  else notify('');
}
function connect() {
  active = Boolean(key);
  $('workspace').hidden = !active;
  $('login').hidden = active;
  $('connection').textContent = active ? 'Administrator session' : 'Disconnected';
  if (active) void refresh();
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const proposed = $('admin-key').value.trim();
  if (!proposed) return;
  key = proposed;
  try {
    await json('/hub/api/clients');
    sessionStorage.setItem('yag_hub_admin_key', key);
    $('admin-key').value = '';
    connect();
  } catch (error) {
    key = '';
    alert('Authentication failed: ' + error.message);
  }
});
$('logout').addEventListener('click', () => {
  key = '';
  sessionStorage.removeItem('yag_hub_admin_key');
  connect();
});
$('refresh').addEventListener('click', () => { void refresh(); });
$('reload-models').addEventListener('click', () => { void loadModels().catch(e => notify(e.message)); });
$('pull-model').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = new FormData(form).get('model');
  try {
    await mutate('/hub/api/models/pull', 'POST', {model: String(name).trim()});
    notify('Model pull started: ' + name + '. Check the jobs indicator.');
    form.reset();
    await loadJobs();
  } catch (error) { notify(error.message); }
});
$('add-client').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const created = await mutate('/hub/api/clients', 'POST',
      {name: String(new FormData(form).get('name')).trim()});
    $('issued-token').textContent = created.key;
    $('issued-key').hidden = false;
    form.reset();
    await loadClients();
  } catch (error) { notify(error.message); }
});
$('copy-issued').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('issued-token').textContent); notify('Key copied. Store it securely.'); }
  catch { notify('Clipboard unavailable. Select and copy the key manually.'); }
});
$('add-node').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await mutate('/hub/api/nodes', 'POST', {
      name: String(data.name).trim(), url: String(data.url).trim(),
      models: String(data.models).split(',').map(v => v.trim()).filter(Boolean),
    });
    form.reset();
    await loadNodes();
  } catch (error) { notify(error.message); }
});
$('backup').addEventListener('click', async () => {
  try {
    const response = await request('/hub/api/backup');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'yag-hub-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite3';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Backup downloaded. Keep it private and encrypted at rest.');
  } catch (error) { notify(error.message); }
});
connect();
setInterval(() => { if (active) void refresh(); }, 15000);
