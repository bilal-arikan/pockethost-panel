// Frontend logic for PocketBaseForge. Vanilla JS, no build step.

const $ = (sel) => document.querySelector(sel)
const rows = $('#rows')
const hint = $('#hint')

function setHint(msg, kind = '') {
  hint.textContent = msg || ''
  hint.className = 'hint' + (kind ? ' ' + kind : '')
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function statePill(inst) {
  if (inst.running) return '<span class="pill run">running</span>'
  if (!inst.onDisk) return '<span class="pill ghost">registry-only</span>'
  return '<span class="pill stop">stopped</span>'
}

async function load() {
  try {
    const res = await fetch('/api/instances')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    render(await res.json())
  } catch (e) {
    setHint('Failed to load: ' + e.message, 'error')
  }
}

function render(data) {
  const status = $('#service-status')
  status.textContent = `apex: ${data.apexDomain}`
  status.className = 'status active'

  if (!data.instances.length) {
    rows.innerHTML = '<tr><td colspan="6" class="empty">No instances yet. Create one above.</td></tr>'
  } else {
    rows.innerHTML = data.instances.map((inst) => `
      <tr>
        <td>
          <div class="name">${inst.name}</div>
          <div class="sub">${inst.name}.${data.apexDomain}</div>
        </td>
        <td>${statePill(inst)}</td>
        <td>${fmtSize(inst.sizeBytes)}</td>
        <td class="sub">${fmtDate(inst.created)}</td>
        <td class="links">
          <a href="${inst.adminUrl}" target="_blank" rel="noopener">Admin ↗</a>
          <a href="${inst.url}/api/health" target="_blank" rel="noopener">API</a>
        </td>
        <td style="text-align:right">
          ${inst.running
            ? `<button class="ghost" data-act="stop" data-name="${inst.name}">Stop</button>`
            : (inst.onDisk ? `<button class="ghost" data-act="start" data-name="${inst.name}">Start</button>` : '')}
          <button class="danger" data-del="${inst.name}">Delete</button>
        </td>
      </tr>
    `).join('')
  }

  $('#creds').innerHTML =
    `Default admin for every instance — email <code>${data.adminEmail}</code>` +
    (data.adminPassword ? ` · password <code>${data.adminPassword}</code>` : '') +
    `. Open <b>Admin ↗</b> on any row to manage that instance's collections.`

  rows.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', () => del(btn.dataset.del)),
  )
  rows.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => action(btn.dataset.act, btn.dataset.name)),
  )
}

async function create() {
  const input = $('#new-name')
  const name = input.value.trim().toLowerCase()
  if (!name) { setHint('Enter a name first.', 'error'); return }
  $('#create-btn').disabled = true
  setHint(`Creating "${name}"… (booting PocketBase + admin setup)`)
  try {
    const res = await fetch('/api/instances', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
    input.value = ''
    setHint(`Created "${name}".`, 'ok')
    await load()
  } catch (e) {
    setHint('Create failed: ' + e.message, 'error')
  } finally {
    $('#create-btn').disabled = false
  }
}

async function action(act, name) {
  setHint(`${act === 'start' ? 'Starting' : 'Stopping'} "${name}"…`)
  try {
    const res = await fetch(`/api/instances/${encodeURIComponent(name)}/${act}`, { method: 'POST' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
    setHint(`${act === 'start' ? 'Started' : 'Stopped'} "${name}".`, 'ok')
    await load()
  } catch (e) {
    setHint(`${act} failed: ` + e.message, 'error')
  }
}

async function del(name) {
  if (!confirm(`Delete instance "${name}"?\n\nThis permanently removes its data. Only this instance is affected.`)) return
  setHint(`Deleting "${name}"…`)
  try {
    const res = await fetch('/api/instances/' + encodeURIComponent(name), { method: 'DELETE' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
    setHint(`Deleted "${name}".`, 'ok')
    await load()
  } catch (e) {
    setHint('Delete failed: ' + e.message, 'error')
  }
}

$('#create-btn').addEventListener('click', create)
$('#refresh-btn').addEventListener('click', () => { setHint(''); load() })
$('#new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') create() })

load()
