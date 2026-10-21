/* Offline runtime for the desktop Quick Panel.
   Stores projects, todos, images, settings, scripts, and themes in IndexedDB,
   and presents the same electronAPI + /api surface the panel already calls. */
(function () {
    const PORT = '17321';
    const ORIGIN = 'http://localhost:' + PORT;
    const APP_VERSION = '1.2.0';
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const DEFAULT_SCRIPTS = {
        'paste-as-plain-text': `// Paste clipboard content as plain text (strips formatting)
(async () => {
    const text = await navigator.clipboard.readText();
    insert(text);
})();
`,
        'copy-as-plain-text': `// Copy current selection as plain text (no formatting)
const text = selection || editor.innerText;
navigator.clipboard.writeText(text);
`,
        'insert-snippet': `// Insert a custom snippet. Edit the variable below to set your text.
const SNIPPET = '【模板】请在这里填入你常用的句子';
insert(SNIPPET);
`,
        'weekday': `// Insert today's Chinese weekday
const days = ['周日','周一','周二','周三','周四','周五','周六'];
insert(days[new Date().getDay()]);
`,
        'view-source': `// View the raw HTML of the current todo in a popup overlay (read-only)
const html = editor.innerHTML;
let overlay = document.getElementById('view-source-overlay');
if (overlay) overlay.remove();
overlay = document.createElement('div');
overlay.id = 'view-source-overlay';
overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:20000;display:flex;align-items:center;justify-content:center;padding:40px;';
const box = document.createElement('div');
box.style.cssText = 'background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:8px;width:100%;max-width:900px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
const header = document.createElement('div');
header.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;';
header.innerHTML = '<span style="flex:1;font-size:12px;color:var(--text-bright);font-weight:600;">Raw HTML source</span>';
const copyBtn = document.createElement('button');
copyBtn.textContent = 'Copy';
copyBtn.style.cssText = 'padding:3px 10px;background:var(--accent);color:var(--accent-text,#fff);border:none;border-radius:4px;font-size:11px;cursor:pointer;';
copyBtn.onclick = () => { navigator.clipboard.writeText(html); copyBtn.textContent = '✓'; setTimeout(() => copyBtn.textContent = 'Copy', 1000); };
const closeBtn = document.createElement('button');
closeBtn.textContent = '✕';
closeBtn.style.cssText = 'padding:3px 8px;background:none;color:var(--text);border:none;cursor:pointer;font-size:14px;';
closeBtn.onclick = () => overlay.remove();
header.appendChild(copyBtn);
header.appendChild(closeBtn);
const pre = document.createElement('pre');
pre.style.cssText = 'flex:1;overflow:auto;padding:12px;margin:0;background:var(--bg);color:var(--text);font-family:Menlo,Monaco,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;';
pre.textContent = html;
box.appendChild(header);
box.appendChild(pre);
overlay.appendChild(box);
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
document.body.appendChild(overlay);
`
    };

    const DEFAULT_PROMPT = `工作周报-xxx
邮件正文模板
一、本周重点工作
（建议：列出核心进展，关键节点可用截图、数据图表展示）
二、下周工作计划
（建议：明确下周的目标、关键动作及预计完成时间）
三、思考或问题求助（重点环节）
（欢迎通过AI对复杂问题进行初步拆解，并配以相关逻辑图或现场图片辅助说明）

帮我写周报，要求精简概要不要无用的描述。语气温度适中，专业，不要有夸大、虚词。

下面我将会发送给你本周我的工作内容，懂了回复 1`;

    const DEFAULT_CUSTOM_THEME = `/* RBTodo Custom Theme */
/* Modify these CSS variables to customize your theme */
body.custom {
    --bg: #1e1e1e;
    --bg-surface: #2a2a2a;
    --bg-input: rgba(255,255,255,0.04);
    --bg-hover: rgba(255,255,255,0.08);
    --bg-subtle: rgba(255,255,255,0.05);
    --bg-btn: rgba(255,255,255,0.06);
    --bg-btn-hover: rgba(255,255,255,0.12);
    --text: #e0e0e0;
    --text-bright: #fff;
    --text-secondary: rgba(255,255,255,0.6);
    --text-muted: rgba(255,255,255,0.35);
    --text-task: rgba(255,255,255,0.85);
    --text-faint: rgba(255,255,255,0.2);
    --text-fainter: rgba(255,255,255,0.13);
    --text-status: rgba(255,255,255,0.28);
    --text-toolbar: rgba(255,255,255,0.55);
    --text-icon: rgba(255,255,255,0.4);
    --border: rgba(255,255,255,0.08);
    --border-light: rgba(255,255,255,0.05);
    --border-lighter: rgba(255,255,255,0.03);
    --border-input: rgba(255,255,255,0.1);
    --border-strong: rgba(255,255,255,0.14);
    --border-checkbox: rgba(255,255,255,0.25);
    --accent: #0a84ff;
    --accent-text: #fff;
    --accent-bg: rgba(10,132,255,0.15);
    --accent-border: rgba(10,132,255,0.4);
    --link: #4fc3f7;
    --link-hover: #81d4fa;
    --danger: #ff453a;
    --danger-text: #ff6b6b;
    --danger-bg: rgba(255,59,48,0.12);
    --danger-bg-hover: rgba(255,59,48,0.22);
    --danger-menu-bg: rgba(255,59,48,0.15);
    --shadow: rgba(0,0,0,0.4);
    --drag-handle: rgba(255,255,255,0.08);
    --select-arrow: rgba(255,255,255,0.35);
    --overlay: rgba(0,0,0,0.6);
    --toast-bg: rgba(0,0,0,0.85);
    --scrollbar: rgba(255,255,255,0.06);
    --scrollbar-hover: rgba(255,255,255,0.12);
}
`;

    function blankState() {
        return {
            projects: { Default: { todos: {} } },
            currentProject: 'Default',
            settings: {},
            customJs: Object.assign({}, DEFAULT_SCRIPTS),
            customThemes: { default: DEFAULT_CUSTOM_THEME },
            weeklyPrompt: DEFAULT_PROMPT,
            updatedAt: Date.now()
        };
    }

    function ensureDefaults(saved) {
        const state = saved && typeof saved === 'object' ? saved : blankState();
        if (!state.projects || typeof state.projects !== 'object') state.projects = {};
        if (!state.projects.Default) state.projects.Default = { todos: {} };
        Object.keys(state.projects).forEach((name) => {
            if (!state.projects[name] || typeof state.projects[name] !== 'object') state.projects[name] = { todos: {} };
            if (!state.projects[name].todos) state.projects[name].todos = {};
        });
        if (!state.currentProject || !state.projects[state.currentProject]) state.currentProject = 'Default';
        state.settings = state.settings || {};
        state.customJs = state.customJs || {};
        Object.keys(DEFAULT_SCRIPTS).forEach((name) => {
            if (!(name in state.customJs)) state.customJs[name] = DEFAULT_SCRIPTS[name];
        });
        state.customThemes = state.customThemes || {};
        if (!state.customThemes.default) state.customThemes.default = DEFAULT_CUSTOM_THEME;
        if (!state.weeklyPrompt) state.weeklyPrompt = DEFAULT_PROMPT;
        return state;
    }

    let state = blankState();
    let db = null;
    const uploadCache = new Map();
    const pathToBlob = new Map();
    const blobToPath = new Map();
    const panelShown = [];
    let releaseNotes = '';

    function uploadKey(project, filename) { return project + '/' + filename; }

    function blobUrlFor(project, filename, item) {
        const key = uploadKey(project, filename);
        if (pathToBlob.has(key)) return pathToBlob.get(key);
        const blob = new Blob([item.bytes], { type: item.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const path = '/uploads/' + encodeURIComponent(filename) + '?project=' + encodeURIComponent(project);
        pathToBlob.set(key, url);
        blobToPath.set(url, path);
        return url;
    }

    function parseUploadUrl(url) {
        if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
        let u;
        try { u = new URL(url, ORIGIN); } catch (e) { return null; }
        if (u.host !== 'localhost:' + PORT && u.host !== '127.0.0.1:' + PORT) return null;
        const marker = '/uploads/';
        const idx = u.pathname.indexOf(marker);
        if (idx === -1) return null;
        const filename = decodeURIComponent(u.pathname.slice(idx + marker.length));
        if (!filename || filename.includes('..') || filename.includes('/')) return null;
        const project = u.searchParams.get('project') || state.currentProject || 'Default';
        return { project, filename };
    }

    function resolveUploadToBlob(url) {
        const parsed = parseUploadUrl(url);
        if (!parsed) return null;
        const item = uploadCache.get(uploadKey(parsed.project, parsed.filename));
        if (!item) return null;
        return blobUrlFor(parsed.project, parsed.filename, item);
    }

    function rewriteUploadHtml(html) {
        if (typeof html !== 'string' || html.indexOf('/uploads/') === -1) return html;
        return html.replace(/(\ssrc\s*=\s*)(["'])([\s\S]*?)\2/gi, (m, pre, q, url) => {
            const blob = resolveUploadToBlob(url);
            return blob ? pre + q + blob + q : m;
        });
    }

    function restoreUploadHtml(html) {
        if (typeof html !== 'string' || html.indexOf('blob:') === -1) return html;
        let out = html;
        blobToPath.forEach((path, blob) => {
            if (out.indexOf(blob) !== -1) out = out.split(blob).join(path);
        });
        return out;
    }

    function installDomBridges() {
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (desc && desc.set && desc.get && desc.configurable) {
            Object.defineProperty(Element.prototype, 'innerHTML', {
                configurable: true,
                enumerable: desc.enumerable,
                get() { return restoreUploadHtml(desc.get.call(this)); },
                set(v) { desc.set.call(this, rewriteUploadHtml(v == null ? '' : String(v))); }
            });
        }
        const origInsert = Element.prototype.insertAdjacentHTML;
        Element.prototype.insertAdjacentHTML = function (position, html) {
            return origInsert.call(this, position, rewriteUploadHtml(html == null ? '' : String(html)));
        };
        const origExec = Document.prototype.execCommand;
        Document.prototype.execCommand = function (cmd, showUI, value) {
            if (typeof cmd === 'string' && cmd.toLowerCase() === 'inserthtml' && typeof value === 'string') {
                value = rewriteUploadHtml(value);
            }
            return origExec.call(this, cmd, showUI, value);
        };
        const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (srcDesc && srcDesc.set && srcDesc.configurable) {
            Object.defineProperty(HTMLImageElement.prototype, 'src', {
                configurable: true,
                enumerable: srcDesc.enumerable,
                get() { return srcDesc.get.call(this); },
                set(v) {
                    const blob = typeof v === 'string' ? resolveUploadToBlob(v) : null;
                    srcDesc.set.call(this, blob || v);
                }
            });
        }
        const origSetAttr = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
            if (this.tagName === 'IMG' && String(name).toLowerCase() === 'src') {
                const blob = resolveUploadToBlob(String(value));
                if (blob) value = blob;
            }
            return origSetAttr.call(this, name, value);
        };
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (downloadExportLink(this)) return;
            return origClick.call(this);
        };
        document.addEventListener('click', (e) => {
            const a = e.target && e.target.closest && e.target.closest('a');
            if (!a) return;
            if (downloadExportLink(a)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    function downloadExportLink(anchor) {
        let u;
        try { u = new URL(anchor.href, location.href); } catch (e) { return false; }
        if (!isOfflineUrl(u.href)) return false;
        const m = u.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
        if (!m) return false;
        const name = decodeURIComponent(m[1]);
        const filename = anchor.download || (name + '.rbproject.zip');
        buildProjectZip(name).then((bytes) => {
            saveBlob(new Blob([bytes], { type: 'application/zip' }), filename);
        }).catch((err) => toast('导出失败: ' + (err && err.message || err)));
        return true;
    }

    function toast(msg) {
        let t = document.getElementById('toast-msg');
        if (!t) {
            t = document.createElement('div');
            t.id = 'toast-msg';
            t.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--toast-bg,#111);color:#fff;padding:6px 16px;border-radius:6px;font-size:12px;z-index:99999;opacity:0;transition:opacity 0.2s;pointer-events:none;';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
    }

    function saveBlob(blob, filename) {
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename || 'download';
        HTMLAnchorElement.prototype.click.call(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('rbtodo-offline', 1);
            req.onupgradeneeded = () => {
                const database = req.result;
                if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
                if (!database.objectStoreNames.contains('uploads')) database.createObjectStore('uploads');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function idbGet(store, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function idbGetAll(store) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            const keys = tx.objectStore(store).getAllKeys();
            let values, ks;
            req.onsuccess = () => { values = req.result; if (ks) resolve(ks.map((key, i) => ({ key, value: values[i] }))); };
            keys.onsuccess = () => { ks = keys.result; if (values) resolve(ks.map((key, i) => ({ key, value: values[i] }))); };
            req.onerror = () => reject(req.error);
            keys.onerror = () => reject(keys.error);
        });
    }

    let persistTimer = null;
    function schedulePersist() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persistState, 60);
    }

    function persistState() {
        state.updatedAt = Date.now();
        try { localStorage.setItem('rbtodo-offline-state', JSON.stringify(state)); } catch (e) {}
        if (!db) return;
        try {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(state, 'state');
        } catch (e) {}
    }

    async function putUpload(project, filename, mime, bytes) {
        const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const key = uploadKey(project, filename);
        uploadCache.set(key, { mime: mime || 'application/octet-stream', bytes: copy });
        pathToBlob.delete(key);
        if (!db) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('uploads', 'readwrite');
            tx.objectStore('uploads').put({ mime: mime || 'application/octet-stream', buffer: copy.buffer }, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function deleteUploadsFor(project) {
        const prefix = project + '/';
        const keys = [];
        uploadCache.forEach((_, key) => { if (key.startsWith(prefix)) keys.push(key); });
        keys.forEach((key) => {
            const blob = pathToBlob.get(key);
            if (blob) { blobToPath.delete(blob); URL.revokeObjectURL(blob); pathToBlob.delete(key); }
            uploadCache.delete(key);
        });
        if (!db || !keys.length) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('uploads', 'readwrite');
            keys.forEach((key) => tx.objectStore('uploads').delete(key));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function renameUploads(oldName, newName) {
        const prefix = oldName + '/';
        const moves = [];
        uploadCache.forEach((item, key) => {
            if (key.startsWith(prefix)) moves.push({ key, filename: key.slice(prefix.length), item });
        });
        moves.forEach(({ key, filename, item }) => {
            const blob = pathToBlob.get(key);
            if (blob) { blobToPath.delete(blob); URL.revokeObjectURL(blob); pathToBlob.delete(key); }
            uploadCache.delete(key);
            uploadCache.set(uploadKey(newName, filename), item);
        });
        if (!db || !moves.length) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('uploads', 'readwrite');
            const store = tx.objectStore('uploads');
            moves.forEach(({ key, filename, item }) => {
                store.delete(key);
                store.put({ mime: item.mime, buffer: item.bytes.buffer }, uploadKey(newName, filename));
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function validProject(name) { return !!name && /^[a-zA-Z0-9_-]+$/.test(name); }

    function ensureProject(name) {
        const project = name || state.currentProject || 'Default';
        if (!state.projects[project]) state.projects[project] = { todos: {} };
        if (!state.projects[project].todos) state.projects[project].todos = {};
        return state.projects[project];
    }

    function todoKey(date, id) { return date + '_' + id; }

    function listTodos(projectName) {
        const proj = ensureProject(projectName);
        return Object.keys(proj.todos).map((key) => {
            const date = key.slice(0, 10);
            return Object.assign({}, proj.todos[key], { date });
        });
    }

    function sortTodos(list) {
        list.sort((a, b) => {
            const ao = typeof a.order === 'number' ? a.order : 999999;
            const bo = typeof b.order === 'number' ? b.order : 999999;
            if (ao !== bo) return ao - bo;
            const ac = a.createdAt || 0, bc = b.createdAt || 0;
            if (ac !== bc) return ac - bc;
            return (a.id || '').localeCompare(b.id || '');
        });
        return list;
    }

    function getTodosForDate(date, projectName) {
        const todos = sortTodos(listTodos(projectName).filter((t) => t.date === date));
        return { todos };
    }

    function saveTodoRecord(date, todo, expectedUpdatedAt, projectName) {
        if (!date || !todo || !todo.id) {
            const err = new Error('date and todo.id required');
            err.status = 400;
            throw err;
        }
        const proj = ensureProject(projectName);
        const key = todoKey(date, todo.id);
        const now = Date.now();
        const prev = proj.todos[key];
        const next = {};
        Object.keys(todo).forEach((k) => {
            if (k !== 'date' && todo[k] !== undefined) next[k] = todo[k];
        });
        next.updatedAt = now;
        if (expectedUpdatedAt && prev && prev.updatedAt && prev.updatedAt > expectedUpdatedAt) {
            if (prev.content !== todo.content || prev.title !== todo.title) {
                next.content = (prev.content || '') + '\n\n<div class="conflict-divider">======= CONFLICT =======</div>\n\n' + (todo.content || '');
                if (prev.title !== todo.title) next.title = (todo.title || '') + ' [CONFLICT]';
                proj.todos[key] = next;
                schedulePersist();
                return { status: 'conflict_merged', updatedAt: now, mergedContent: next.content };
            }
        }
        proj.todos[key] = next;
        schedulePersist();
        return { status: 'saved', updatedAt: now };
    }

    function deleteTodoRecord(date, id, projectName) {
        const proj = ensureProject(projectName);
        delete proj.todos[todoKey(date, id)];
        schedulePersist();
        return { success: true };
    }

    function updateOrder(date, todos, projectName) {
        const proj = ensureProject(projectName);
        (todos || []).forEach((item, i) => {
            const rec = proj.todos[todoKey(date, item.id)];
            if (rec) rec.order = i;
        });
        schedulePersist();
        return { success: true };
    }

    function localDateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function startOfIsoWeek(dateStr) {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? new Date(dateStr + 'T00:00:00') : new Date();
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1);
        return d;
    }

    function getWeeklyData(dateStr, projectName) {
        const start = startOfIsoWeek(dateStr);
        const result = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = localDateStr(d);
            const data = getTodosForDate(key, projectName);
            if (data.todos.length) result[key] = data;
        }
        return result;
    }

    function isOfflineUrl(url) {
        try {
            const u = new URL(url, location.href);
            return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && String(u.port) === PORT;
        } catch (e) { return false; }
    }

    function headerGet(headers, name) {
        if (!headers) return '';
        if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || '';
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : '';
    }

    function projectFrom(url, headers) {
        const u = new URL(url, ORIGIN);
        const q = u.searchParams.get('project');
        if (validProject(q)) return q;
        const h = headerGet(headers, 'x-project');
        if (validProject(h)) return h;
        return state.currentProject || 'Default';
    }

    function apiError(status, message) {
        return { status, json: { error: message } };
    }

    function handleApi(method, url, body, headers) {
        const u = new URL(url, ORIGIN);
        const path = decodeURIComponent(u.pathname);
        const verb = String(method || 'GET').toUpperCase();
        const project = projectFrom(u.href, headers);

        if (path.startsWith('/uploads/')) {
            const filename = decodeURIComponent(path.slice('/uploads/'.length));
            const item = uploadCache.get(uploadKey(project, filename));
            if (!item) return { status: 404, json: { error: 'not found' } };
            return { status: 200, raw: item.bytes, mime: item.mime || 'application/octet-stream' };
        }
        if (path === '/api/app-config') return { status: 200, json: { title: 'RBTodo', shortTitle: 'RBTodo' } };
        if (path === '/api/lock' || path === '/api/unlock' || path === '/api/lock/heartbeat') {
            return { status: 200, json: { success: true } };
        }
        if (path === '/api/todos/all' && verb === 'GET') return { status: 200, json: listTodos(project) };
        if (path === '/api/todos' && verb === 'GET') return { status: 200, json: getTodosForDate(u.searchParams.get('date'), project) };
        if (path === '/api/todos' && verb === 'POST') {
            return { status: 200, json: saveTodoRecord(body && body.date, body && body.todo, body && body.expectedUpdatedAt, project) };
        }
        if (path === '/api/todos/order' && verb === 'POST') return { status: 200, json: updateOrder(body && body.date, body && body.todos, project) };
        if (path === '/api/todos/delete' && verb === 'POST') return { status: 200, json: deleteTodoRecord(body && body.date, body && body.id, project) };
        if (path === '/api/old-todos' && verb === 'GET') {
            const today = u.searchParams.get('date') || localDateStr(new Date());
            const list = listTodos(project).filter((t) => t.date < today && !t.completed);
            list.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.order || 0) - (b.order || 0));
            return { status: 200, json: list };
        }
        if (path === '/api/future-todos' && verb === 'GET') {
            const today = u.searchParams.get('date') || localDateStr(new Date());
            const list = listTodos(project).filter((t) => t.date > today);
            list.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.order || 0) - (b.order || 0));
            return { status: 200, json: list };
        }
        if (path === '/api/todo-dates' && verb === 'GET') {
            const dates = new Set();
            listTodos(project).forEach((t) => { if (t.date) dates.add(t.date); });
            return { status: 200, json: Array.from(dates) };
        }
        if (path === '/api/search' && verb === 'GET') {
            const q = (u.searchParams.get('q') || '').toLowerCase();
            if (!q) return { status: 200, json: [] };
            const results = listTodos(project).filter((t) => {
                const id = String(t.id || '').toLowerCase();
                return (t.title && t.title.toLowerCase().includes(q)) ||
                    (t.content && String(t.content).toLowerCase().includes(q)) ||
                    id.includes(q) || id.slice(0, 8) === q;
            }).sort((a, b) => {
                const rank = (t) => {
                    const id = String(t.id || '').toLowerCase();
                    return (id === q || id.slice(0, 8) === q || id.startsWith(q)) ? 0 : 1;
                };
                return rank(a) - rank(b);
            });
            return { status: 200, json: results };
        }
        if (path === '/api/stats' && verb === 'POST') {
            const stats = {};
            ((body && body.dates) || []).forEach((date) => {
                const todos = getTodosForDate(date, project).todos;
                stats[date] = { total: todos.length, completed: todos.filter((t) => t.completed).length };
            });
            return { status: 200, json: stats };
        }
        if (path === '/api/export' && verb === 'GET') return { status: 200, json: getWeeklyData(u.searchParams.get('date'), project) };
        if (path === '/api/export-all' && verb === 'GET') {
            const data = getWeeklyData(u.searchParams.get('date'), project);
            const all = {};
            if (Object.keys(data).length) all[project] = data;
            return { status: 200, json: all };
        }
        if (path === '/api/projects' && verb === 'GET') {
            const projects = Object.keys(state.projects).sort();
            return { status: 200, json: { projects, currentProject: project } };
        }
        if (path === '/api/projects/switch' && verb === 'POST') {
            const name = body && body.name;
            if (!name) return apiError(400, 'Project name required');
            if (!state.projects[name]) return apiError(400, 'Project not found');
            state.currentProject = name;
            schedulePersist();
            return { status: 200, json: { success: true, currentProject: name } };
        }
        if (path === '/api/projects/create' && verb === 'POST') {
            const name = body && body.name;
            if (!validProject(name)) return apiError(400, 'Invalid project name');
            if (state.projects[name]) return apiError(400, 'Project already exists');
            state.projects[name] = { todos: {} };
            schedulePersist();
            return { status: 200, json: { success: true, name } };
        }
        if (path === '/api/projects/rename' && verb === 'POST') {
            const oldName = body && body.oldName;
            const newName = body && body.newName;
            if (!validProject(newName)) return apiError(400, 'Invalid new project name');
            if (oldName === 'Default') return apiError(400, 'Cannot rename Default project');
            if (!state.projects[oldName]) return apiError(400, 'Project not found');
            if (state.projects[newName]) return apiError(400, 'Name already exists');
            state.projects[newName] = state.projects[oldName];
            delete state.projects[oldName];
            if (state.currentProject === oldName) state.currentProject = newName;
            schedulePersist();
            renameUploads(oldName, newName);
            return { status: 200, json: { success: true, name: newName } };
        }
        const exportMatch = path.match(/^\/api\/projects\/([^/]+)\/export$/);
        if (exportMatch && verb === 'GET') {
            return { status: 200, zipProject: decodeURIComponent(exportMatch[1]) };
        }
        const deleteMatch = path.match(/^\/api\/projects\/([^/]+)$/);
        if (deleteMatch && verb === 'DELETE') {
            const name = decodeURIComponent(deleteMatch[1]);
            if (name === 'Default') return apiError(400, 'Cannot delete Default project');
            if (name === state.currentProject) return apiError(400, 'Cannot delete active project');
            if (!state.projects[name]) return apiError(400, 'Project not found');
            delete state.projects[name];
            schedulePersist();
            deleteUploadsFor(name);
            return { status: 200, json: { success: true } };
        }
        return apiError(404, 'Not found');
    }

    function jsonResult(result) {
        return {
            status: result.status,
            body: JSON.stringify(result.json == null ? {} : result.json)
        };
    }

    function dispatchSync(method, url, rawBody, headers) {
        let body = null;
        if (typeof rawBody === 'string' && rawBody) {
            try { body = JSON.parse(rawBody); } catch (e) { body = null; }
        }
        try {
            const result = handleApi(method, url, body, headers);
            if (result.raw || result.zipProject) return { status: 400, body: JSON.stringify({ error: 'sync binary unsupported' }) };
            return jsonResult(result);
        } catch (err) {
            return { status: err.status || 500, body: JSON.stringify({ error: err.message || 'error' }) };
        }
    }

    function toResponse(result) {
        if (result.raw) {
            return new Response(result.raw, { status: result.status, headers: { 'Content-Type': result.mime || 'application/octet-stream' } });
        }
        const packed = jsonResult(result);
        return new Response(packed.body, { status: packed.status, headers: { 'Content-Type': 'application/json' } });
    }

    async function readInitBody(init, input) {
        let method = (init && init.method) || (input && input.method) || 'GET';
        let headers = (init && init.headers) || (input && input.headers) || {};
        let body = init && Object.prototype.hasOwnProperty.call(init, 'body') ? init.body : null;
        if (body == null && input && typeof input.clone === 'function' && String(method).toUpperCase() !== 'GET' && String(method).toUpperCase() !== 'HEAD') {
            try { body = await input.clone().blob(); } catch (e) {}
        }
        if (body == null) return { method, headers, kind: 'empty', json: null, form: null };
        if (typeof FormData !== 'undefined' && body instanceof FormData) return { method, headers, kind: 'form', form: body, json: null };
        if (typeof body === 'string') {
            let json = null;
            try { json = body ? JSON.parse(body) : null; } catch (e) {}
            return { method, headers, kind: 'text', json, form: null };
        }
        if (typeof Blob !== 'undefined' && body instanceof Blob) {
            const text = await body.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) {}
            return { method, headers, kind: 'text', json, form: null, blob: body };
        }
        return { method, headers, kind: 'text', json: null, form: null };
    }

    async function handleUpload(form, headers) {
        const file = form.get('image');
        if (!file) return apiError(400, 'No file uploaded.');
        const project = headerGet(headers, 'x-project') || state.currentProject || 'Default';
        const safeProject = validProject(project) ? project : (state.currentProject || 'Default');
        const name = file.name || 'image';
        const extMatch = name.match(/\.[a-z0-9]+$/i);
        const ext = extMatch ? extMatch[0] : (file.type === 'image/png' ? '.png' : file.type === 'image/gif' ? '.gif' : file.type === 'image/webp' ? '.webp' : '.jpg');
        const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await putUpload(safeProject, filename, file.type || 'application/octet-stream', bytes);
        return { status: 200, json: { url: '/uploads/' + filename + '?project=' + encodeURIComponent(safeProject) } };
    }

    async function handleImport(form) {
        const file = form.get('file');
        if (!file) return apiError(400, 'Zip file required');
        let projectName = (file.name || 'import').replace(/\.rbproject\.zip$|\.zip$/i, '');
        projectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'import';
        let finalName = projectName;
        if (state.projects[finalName]) finalName = projectName + '_' + Date.now();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const entries = await unzip(bytes);
        state.projects[finalName] = { todos: {} };
        for (const entry of entries) {
            const norm = entry.name.replace(/\\/g, '/');
            if (!norm || norm.endsWith('/') || norm.includes('..')) continue;
            const dataAt = norm.toLowerCase().lastIndexOf('data/');
            const upAt = norm.toLowerCase().lastIndexOf('uploads/');
            if (dataAt !== -1 && norm.toLowerCase().endsWith('.json') && (upAt === -1 || dataAt > upAt)) {
                const base = norm.slice(dataAt + 'data/'.length).replace(/\.json$/i, '');
                const match = base.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
                if (!match) continue;
                try {
                    const todo = JSON.parse(dec.decode(entry.data));
                    delete todo.date;
                    state.projects[finalName].todos[match[1] + '_' + match[2]] = todo;
                } catch (e) {}
            } else if (upAt !== -1) {
                const filename = norm.slice(upAt + 'uploads/'.length);
                if (!filename || filename.includes('/')) continue;
                await putUpload(finalName, filename, mimeFromName(filename), entry.data);
            }
        }
        schedulePersist();
        return { status: 200, json: { success: true, name: finalName } };
    }

    function mimeFromName(name) {
        const n = name.toLowerCase();
        if (n.endsWith('.png')) return 'image/png';
        if (n.endsWith('.gif')) return 'image/gif';
        if (n.endsWith('.webp')) return 'image/webp';
        if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
        if (n.endsWith('.svg')) return 'image/svg+xml';
        return 'application/octet-stream';
    }

    async function handleFetch(url, init, input) {
        const read = await readInitBody(init, input);
        try {
            if (read.form) {
                const u = new URL(url, ORIGIN);
                if (u.pathname === '/api/upload') return toResponse(await handleUpload(read.form, read.headers));
                if (u.pathname === '/api/projects/import') return toResponse(await handleImport(read.form));
                return toResponse(apiError(400, 'Unexpected form upload'));
            }
            const result = handleApi(read.method, url, read.json, read.headers);
            if (result.zipProject) {
                const bytes = await buildProjectZip(result.zipProject);
                return new Response(bytes, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/zip',
                        'Content-Disposition': 'attachment; filename=' + result.zipProject + '.rbproject.zip'
                    }
                });
            }
            return toResponse(result);
        } catch (err) {
            return toResponse(apiError(err.status || 500, err.message || 'error'));
        }
    }

    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? String(input) : (input && input.url) || '';
        if (!isOfflineUrl(url)) return origFetch(input, init);
        return handleFetch(url, init || {}, typeof input === 'string' || input instanceof URL ? null : input);
    };

    const NativeXHR = window.XMLHttpRequest;
    function OfflineXHR() {
        const native = new NativeXHR();
        let method = 'GET';
        let url = '';
        let hijack = false;
        const headers = {};
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.response = '';
        this.responseType = '';
        this.onreadystatechange = null;
        this.upload = native.upload;
        this.open = function (m, u, asyncFlag) {
            method = m;
            url = String(u);
            hijack = isOfflineUrl(url);
            this.readyState = 1;
            if (!hijack) native.open(m, u, asyncFlag !== false);
        };
        this.setRequestHeader = function (k, v) {
            headers[k] = v;
            if (!hijack) {
                try { native.setRequestHeader(k, v); } catch (e) {}
            }
        };
        this.send = function (body) {
            if (!hijack) {
                native.onreadystatechange = () => {
                    this.readyState = native.readyState;
                    this.status = native.status;
                    this.statusText = native.statusText;
                    try { this.responseText = native.responseText; } catch (e) {}
                    this.response = native.response;
                    if (this.onreadystatechange) this.onreadystatechange();
                };
                return native.send(body);
            }
            const result = dispatchSync(method, url, typeof body === 'string' ? body : '', headers);
            this.status = result.status;
            this.statusText = result.status >= 200 && result.status < 300 ? 'OK' : 'Error';
            this.responseText = result.body;
            this.response = result.body;
            this.readyState = 4;
            if (this.onreadystatechange) this.onreadystatechange();
        };
        this.abort = function () { if (!hijack) native.abort(); };
        this.getAllResponseHeaders = function () {
            return hijack ? 'content-type: application/json\r\n' : native.getAllResponseHeaders();
        };
        this.getResponseHeader = function (h) {
            if (hijack) return String(h).toLowerCase() === 'content-type' ? 'application/json' : null;
            return native.getResponseHeader(h);
        };
        this.addEventListener = function () {
            if (!hijack) native.addEventListener.apply(native, arguments);
        };
        this.removeEventListener = function () {
            if (!hijack) native.removeEventListener.apply(native, arguments);
        };
    }
    window.XMLHttpRequest = OfflineXHR;

    const origBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
    navigator.sendBeacon = function (url, data) {
        if (!isOfflineUrl(url)) return origBeacon ? origBeacon(url, data) : false;
        if (typeof data === 'string') {
            dispatchSync('POST', url, data, { 'Content-Type': 'application/json' });
            return true;
        }
        if (data && typeof data.text === 'function') {
            data.text().then((text) => dispatchSync('POST', url, text, { 'Content-Type': 'application/json' }));
            return true;
        }
        return true;
    };

    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
    function pushU16(arr, n) { arr.push(n & 255, (n >> 8) & 255); }
    function pushU32(arr, n) { arr.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255); }

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let c = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    function dosStamp(date) {
        const d = date || new Date();
        const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        return { time, day };
    }

    async function deflateRaw(bytes) {
        if (typeof CompressionStream !== 'function' || bytes.length < 32) return { method: 0, data: bytes };
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            const out = new Uint8Array(await new Response(stream).arrayBuffer());
            if (!out.length || out.length >= bytes.length) return { method: 0, data: bytes };
            return { method: 8, data: out };
        } catch (e) {
            return { method: 0, data: bytes };
        }
    }

    async function zipFiles(files) {
        const local = [];
        const central = [];
        let offset = 0;
        const stamp = dosStamp(new Date());
        for (const file of files) {
            const nameBytes = enc.encode(file.name);
            const raw = file.data instanceof Uint8Array ? file.data : enc.encode(String(file.data || ''));
            const packed = await deflateRaw(raw);
            const crc = crc32(raw);
            const localStart = offset;
            const h = [];
            pushU32(h, 0x04034b50);
            pushU16(h, 20);
            pushU16(h, 0x0800);
            pushU16(h, packed.method);
            pushU16(h, stamp.time);
            pushU16(h, stamp.day);
            pushU32(h, crc);
            pushU32(h, packed.data.length);
            pushU32(h, raw.length);
            pushU16(h, nameBytes.length);
            pushU16(h, 0);
            local.push(new Uint8Array(h), nameBytes, packed.data);
            offset += h.length + nameBytes.length + packed.data.length;
            const c = [];
            pushU32(c, 0x02014b50);
            pushU16(c, 20);
            pushU16(c, 20);
            pushU16(c, 0x0800);
            pushU16(c, packed.method);
            pushU16(c, stamp.time);
            pushU16(c, stamp.day);
            pushU32(c, crc);
            pushU32(c, packed.data.length);
            pushU32(c, raw.length);
            pushU16(c, nameBytes.length);
            pushU16(c, 0);
            pushU16(c, 0);
            pushU16(c, 0);
            pushU16(c, 0);
            pushU32(c, 0);
            pushU32(c, localStart);
            central.push(new Uint8Array(c), nameBytes);
        }
        const centralStart = offset;
        let centralSize = 0;
        central.forEach((part) => { centralSize += part.length; });
        const end = [];
        pushU32(end, 0x06054b50);
        pushU16(end, 0);
        pushU16(end, 0);
        pushU16(end, files.length);
        pushU16(end, files.length);
        pushU32(end, centralSize);
        pushU32(end, centralStart);
        pushU16(end, 0);
        const parts = local.concat(central, [new Uint8Array(end)]);
        const total = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(total);
        let cursor = 0;
        parts.forEach((part) => { out.set(part, cursor); cursor += part.length; });
        return out;
    }

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'function') throw new Error('这个浏览器不能解压 zip');
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function unzip(bytes) {
        let eocd = -1;
        const min = Math.max(0, bytes.length - 22 - 65535);
        for (let i = bytes.length - 22; i >= min; i--) {
            if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('不是有效的 zip');
        const count = u16(bytes, eocd + 10);
        let cursor = u32(bytes, eocd + 16);
        const entries = [];
        for (let n = 0; n < count; n++) {
            if (u32(bytes, cursor) !== 0x02014b50) throw new Error('zip 目录损坏');
            const method = u16(bytes, cursor + 10);
            const compSize = u32(bytes, cursor + 20);
            const nameLen = u16(bytes, cursor + 28);
            const extraLen = u16(bytes, cursor + 30);
            const commentLen = u16(bytes, cursor + 32);
            const localOff = u32(bytes, cursor + 42);
            const name = dec.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
            const localNameLen = u16(bytes, localOff + 26);
            const localExtraLen = u16(bytes, localOff + 28);
            const dataStart = localOff + 30 + localNameLen + localExtraLen;
            const comp = bytes.subarray(dataStart, dataStart + compSize);
            let data;
            if (method === 0) data = comp;
            else if (method === 8) data = await inflateRaw(comp);
            else throw new Error('不支持的压缩方式 ' + method);
            entries.push({ name, data });
            cursor += 46 + nameLen + extraLen + commentLen;
        }
        return entries;
    }

    async function buildProjectZip(projectName) {
        if (!state.projects[projectName]) throw new Error('Project not found');
        const files = [];
        const todos = state.projects[projectName].todos || {};
        Object.keys(todos).forEach((key) => {
            files.push({ name: 'data/' + key + '.json', data: enc.encode(JSON.stringify(todos[key], null, 2)) });
        });
        const prefix = projectName + '/';
        uploadCache.forEach((item, key) => {
            if (key.startsWith(prefix)) files.push({ name: 'uploads/' + key.slice(prefix.length), data: item.bytes });
        });
        if (!files.length) files.push({ name: 'data/.keep', data: enc.encode('') });
        return zipFiles(files);
    }

    function hidePanel() {
        if (document.getElementById('offline-hidden-veil')) return;
        const veil = document.createElement('div');
        veil.id = 'offline-hidden-veil';
        veil.style.cssText = 'position:fixed;inset:0;z-index:40000;background:var(--bg,#111);color:var(--text-muted,#aaa);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;';
        veil.textContent = '点击恢复 RBTodo';
        veil.addEventListener('click', () => {
            veil.remove();
            panelShown.forEach((cb) => { try { cb(); } catch (e) {} });
        });
        document.body.appendChild(veil);
    }

    function openOverlay(title, bodyNode) {
        const overlay = document.createElement('div');
        overlay.className = 'set-overlay';
        overlay.style.zIndex = '30000';
        const panel = document.createElement('div');
        panel.style.cssText = 'background:var(--bg);color:var(--text);border:1px solid var(--border-input);border-radius:12px;width:min(860px,94vw);height:min(640px,88vh);display:flex;flex-direction:column;overflow:hidden;';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);';
        const heading = document.createElement('strong');
        heading.textContent = title;
        heading.style.color = 'var(--text-bright)';
        const spacer = document.createElement('span');
        spacer.style.flex = '1';
        const close = document.createElement('button');
        close.textContent = '✕';
        close.className = 'set-close';
        bar.append(heading, spacer, close);
        panel.append(bar, bodyNode);
        overlay.appendChild(panel);
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            closeOverlay();
        };
        function closeOverlay() {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
        }
        close.onclick = closeOverlay;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        return { overlay, close: closeOverlay };
    }

    function openAssetEditor(kind) {
        if (document.getElementById('offline-asset-editor')) return;
        const isTheme = kind === 'theme';
        const bag = isTheme ? state.customThemes : state.customJs;
        const ext = isTheme ? '.css' : '.js';
        const body = document.createElement('div');
        body.id = 'offline-asset-editor';
        body.style.cssText = 'display:flex;flex:1;min-height:0;';
        const list = document.createElement('div');
        list.style.cssText = 'width:200px;overflow:auto;border-right:1px solid var(--border);padding:8px;';
        const editor = document.createElement('textarea');
        editor.style.cssText = 'flex:1;border:none;resize:none;background:var(--bg-input);color:var(--text);padding:12px;font:12px/1.5 Menlo,Monaco,monospace;outline:none;';
        const side = document.createElement('div');
        side.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;padding:8px;border-top:1px solid var(--border);';
        function makeBtn(label) {
            const b = document.createElement('button');
            b.textContent = label;
            b.className = 'set-btn';
            return b;
        }
        const btnNew = makeBtn('新建');
        const btnSave = makeBtn('保存');
        const btnDelete = makeBtn('删除');
        const btnImport = makeBtn('导入文件');
        actions.append(btnNew, btnSave, btnDelete, btnImport);
        side.append(editor, actions);
        body.append(list, side);
        let current = Object.keys(bag)[0] || '';
        function renderList() {
            list.innerHTML = '';
            Object.keys(bag).sort().forEach((name) => {
                const item = document.createElement('button');
                item.textContent = name + ext;
                item.style.cssText = 'display:block;width:100%;text-align:left;margin:0 0 4px;padding:6px 8px;border-radius:6px;border:none;cursor:pointer;background:' + (name === current ? 'var(--accent-bg)' : 'transparent') + ';color:var(--text);';
                item.onclick = () => { current = name; editor.value = bag[name] || ''; renderList(); };
                list.appendChild(item);
            });
        }
        editor.value = current ? (bag[current] || '') : '';
        renderList();
        btnSave.onclick = () => {
            if (!current) return;
            bag[current] = editor.value;
            schedulePersist();
            toast('已保存 ' + current + ext);
        };
        btnNew.onclick = () => {
            const name = prompt(isTheme ? '主题文件名（不含 .css）' : '脚本名（不含 .js）', isTheme ? 'my-theme' : 'my-script');
            if (!name) return;
            const clean = name.replace(/\.(css|js)$/i, '').replace(/[^\w.-]+/g, '_');
            if (!clean) return;
            if (!bag[clean]) bag[clean] = isTheme ? DEFAULT_CUSTOM_THEME : '// ' + clean + '\n';
            current = clean;
            editor.value = bag[clean];
            schedulePersist();
            renderList();
        };
        btnDelete.onclick = () => {
            if (!current || current === 'default' && isTheme) { toast(isTheme ? 'default 主题不能删除' : '请选择脚本'); return; }
            if (isTheme && current === 'default') return;
            delete bag[current];
            current = Object.keys(bag)[0] || '';
            editor.value = current ? bag[current] : '';
            schedulePersist();
            renderList();
        };
        btnImport.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = isTheme ? '.css,text/css' : '.js,text/javascript';
            input.onchange = () => {
                const file = input.files && input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    const name = file.name.replace(/\.(css|js)$/i, '').replace(/[^\w.-]+/g, '_') || 'imported';
                    bag[name] = String(reader.result || '');
                    current = name;
                    editor.value = bag[name];
                    schedulePersist();
                    renderList();
                    toast('已导入 ' + file.name);
                };
                reader.readAsText(file);
            };
            input.click();
        };
        openOverlay(isTheme ? '自定义主题（浏览器里代替主题文件夹）' : '自定义脚本（浏览器里代替脚本文件夹）', body);
    }

    function openReport(md) {
        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';
        const tools = document.createElement('div');
        tools.style.cssText = 'display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy All';
        copyBtn.className = 'set-btn';
        const promptBtn = document.createElement('button');
        promptBtn.textContent = 'Edit Prompt';
        promptBtn.className = 'set-btn';
        tools.append(copyBtn, promptBtn);
        const pre = document.createElement('pre');
        pre.contentEditable = 'true';
        pre.spellcheck = false;
        pre.style.cssText = 'flex:1;margin:0;padding:16px 20px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.7 Menlo,Monaco,monospace;outline:none;';
        let reportText = md || '';
        let promptText = state.weeklyPrompt || DEFAULT_PROMPT;
        pre.textContent = promptText + '\n\n---\n\n' + reportText;
        copyBtn.onclick = async () => {
            try { await navigator.clipboard.writeText(pre.innerText); toast('Copied!'); }
            catch (e) { toast('复制失败'); }
        };
        promptBtn.onclick = () => {
            if (promptBtn.textContent === 'Edit Prompt') {
                pre.textContent = promptText;
                pre.focus();
                promptBtn.textContent = 'Save Prompt';
            } else {
                promptText = pre.innerText;
                state.weeklyPrompt = promptText;
                schedulePersist();
                pre.textContent = promptText + '\n\n---\n\n' + reportText;
                promptBtn.textContent = 'Edit Prompt';
                toast('Prompt saved');
            }
        };
        body.append(tools, pre);
        openOverlay('Weekly Report', body);
    }

    function openHelp() {
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow:auto;padding:8px 18px 18px;font-size:13px;line-height:1.65;';
        body.innerHTML = [
            '<p>这是桌面快捷面板的离线页面。待办、图片、主题和脚本都保存在这个浏览器里，不需要 Electron，也不需要本地服务器。</p>',
            '<p><b>快捷键</b></p>',
            '<ul>',
            '<li>Enter：新建待办</li>',
            '<li>⌘S / Ctrl+S：保存当前待办</li>',
            '<li>⌘, / Ctrl+,：设置</li>',
            '<li>⌘O / Ctrl+O：搜索</li>',
            '<li>⌘F / Ctrl+F：在当前笔记里查找</li>',
            '<li>⌘L / Ctrl+L：放大编辑</li>',
            '<li>⌘+ ⌘- ⌘0：界面缩放</li>',
            '<li>← →：切换日期，到头后跨周</li>',
            '<li>↑ ↓：切换待办</li>',
            '<li>Esc：逐层退出；没有打开的内容时收起页面</li>',
            '</ul>',
            '<p><b>和桌面版的差别</b></p>',
            '<ul>',
            '<li>数据在 IndexedDB，换浏览器或清站点数据会丢掉，除非先从菜单导出项目。</li>',
            '<li>Open Project Folder 会下载当前项目的 zip，格式与桌面版项目包一致。</li>',
            '<li>全局快捷键和开机启动在网页里不可用。</li>',
            '<li>右键工具栏 🔧，或设置里的脚本/主题文件夹，会打开页内编辑器。</li>',
            '<li>设置里仍可连接远程服务器；连上之后读写走远程，本地数据留在浏览器里。</li>',
            '</ul>'
        ].join('');
        openOverlay('RBTodo Help', body);
    }

    function openImageViewer(src) {
        const list = [];
        document.querySelectorAll('#editor-content img').forEach((node) => {
            const url = node.currentSrc || node.src;
            if (url && !list.includes(url)) list.push(url);
        });
        if (src && !list.includes(src)) list.unshift(src);
        if (!list.length && src) list.push(src);
        let index = Math.max(0, list.indexOf(src));
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:35000;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;';
        const img = document.createElement('img');
        img.alt = '';
        img.style.cssText = 'max-width:82vw;max-height:88vh;object-fit:contain;';
        const btnStyle = 'position:absolute;top:50%;transform:translateY(-50%);width:48px;height:72px;border:none;border-radius:8px;background:rgba(255,255,255,0.14);color:#fff;font-size:32px;cursor:pointer;';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.textContent = '‹';
        prev.title = '上一张 (←)';
        prev.style.cssText = btnStyle + 'left:16px;';
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = '›';
        next.title = '下一张 (→)';
        next.style.cssText = btnStyle + 'right:16px;';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭 (Esc)';
        closeBtn.style.cssText = 'position:absolute;top:12px;right:16px;width:36px;height:36px;border:none;border-radius:8px;background:rgba(255,255,255,0.14);color:#fff;font-size:22px;cursor:pointer;';
        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#ddd;font-size:13px;pointer-events:none;';
        overlay.append(img, prev, next, closeBtn, label);
        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
        };
        const show = (i) => {
            if (!list.length) return;
            index = (i + list.length) % list.length;
            img.src = list[index];
            label.textContent = list.length > 1 ? (index + 1) + ' / ' + list.length + '   ← → 切换' : '';
            const many = list.length > 1;
            prev.style.visibility = many ? 'visible' : 'hidden';
            next.style.visibility = many ? 'visible' : 'hidden';
        };
        prev.addEventListener('click', (e) => { e.stopPropagation(); show(index - 1); });
        next.addEventListener('click', (e) => { e.stopPropagation(); show(index + 1); });
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
        img.addEventListener('click', (e) => e.stopPropagation());
        overlay.addEventListener('click', (e) => {
            if (e.target !== overlay) return;
            const x = e.clientX / Math.max(1, overlay.clientWidth);
            if (list.length > 1 && x < 0.2) show(index - 1);
            else if (list.length > 1 && x > 0.8) show(index + 1);
            else close();
        });
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); show(index - 1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); show(index + 1); }
        };
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        show(index);
    }

    async function blobToPng(blob) {
        if (blob.type === 'image/png') return blob;
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close && bmp.close();
        return await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('png failed')), 'image/png'));
    }

    async function exportLongImage(html, title) {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:400px;border:0;';
        document.body.appendChild(iframe);
        try {
            await new Promise((resolve, reject) => {
                iframe.onload = resolve;
                iframe.onerror = reject;
                iframe.srcdoc = html;
            });
            const doc = iframe.contentDocument;
            await Promise.all([...doc.images].map((img) => img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })));
            const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 200);
            const xml = new XMLSerializer();
            const styleEl = doc.querySelector('style');
            const headXml = styleEl ? xml.serializeToString(styleEl) : '';
            const bodyXml = xml.serializeToString(doc.body);
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' + height + '"><foreignObject width="800" height="' + height + '">' + headXml + bodyXml + '</foreignObject></svg>';
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error('长图渲染失败'));
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            });
            const canvas = document.createElement('canvas');
            const scale = 2;
            canvas.width = 800 * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 800, height);
            ctx.drawImage(img, 0, 0, 800, height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) return { success: false, error: '长图导出失败' };
            const safe = String(title || 'export').replace(/[\\/:*?"<>|]/g, '_');
            saveBlob(blob, safe + '.png');
            return { success: true };
        } catch (err) {
            return { success: false, error: '长图渲染失败' };
        } finally {
            iframe.remove();
        }
    }

    function cmpVersion(a, b) {
        const pa = String(a || '').split(/[.\-]/).map((s) => parseInt(s, 10) || 0);
        const pb = String(b || '').split(/[.\-]/).map((s) => parseInt(s, 10) || 0);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
        }
        return 0;
    }

    const panelListeners = { openTodo: [], navigate: [] };

    window.electronAPI = {
        getServerPort: async () => Number(PORT),
        getDataDir: async () => '浏览器 IndexedDB（rbtodo-offline）',
        openMainWindow: () => {},
        openQuickTodo: (todoId) => { panelListeners.openTodo.forEach((cb) => cb(todoId)); },
        lockBlur: () => {},
        unlockBlur: () => {},
        setPinned: () => {},
        setRemoteAuth: () => {},
        listCustomJs: async () => Object.keys(state.customJs).sort(),
        getCustomJs: async (name) => state.customJs[name] || '',
        openCustomJsFolder: () => openAssetEditor('script'),
        openProjectFolder: (project) => {
            const name = project || state.currentProject || 'Default';
            buildProjectZip(name).then((bytes) => {
                saveBlob(new Blob([bytes], { type: 'application/zip' }), name + '.rbproject.zip');
                toast('已下载项目数据 ' + name + '.rbproject.zip');
            }).catch((err) => toast('导出失败: ' + (err.message || err)));
        },
        openExternal: (url) => {
            if (!url) return;
            if (isOfflineUrl(url)) {
                toast('离线页面没有单独的本地网站，数据就在这个页面里');
                return;
            }
            if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
        },
        openPath: (p) => { toast(p ? '浏览器不能打开本地路径' : '没有路径'); },
        hidePanel,
        openImageViewer,
        copyImage: async (_filePath, originalSrc) => {
            try {
                const res = await origFetch(originalSrc);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const png = await blobToPng(await res.blob());
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message || 'copy failed' };
            }
        },
        saveImage: async (_filePath, originalSrc) => {
            try {
                const res = await origFetch(originalSrc);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const blob = await res.blob();
                let filename = 'image';
                try { filename = decodeURIComponent(new URL(originalSrc).pathname.split('/').pop()) || filename; } catch (e) {}
                saveBlob(blob, filename);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message || 'save failed' };
            }
        },
        openReportWindow: (md) => openReport(md),
        getWeeklyPrompt: async () => state.weeklyPrompt || DEFAULT_PROMPT,
        setWeeklyPrompt: async (text) => { state.weeklyPrompt = text || ''; schedulePersist(); },
        getShortcut: async () => state.settings.shortcut || 'CommandOrControl+Shift+T',
        setShortcut: async (shortcut) => {
            state.settings.shortcut = shortcut;
            schedulePersist();
            return { success: true };
        },
        getSetting: async (key) => state.settings[key] ?? null,
        setSetting: async (key, val) => { state.settings[key] = val; schedulePersist(); },
        onPanelShown: (callback) => { if (typeof callback === 'function') panelShown.push(callback); },
        onOpenTodo: (callback) => { if (typeof callback === 'function') panelListeners.openTodo.push(callback); },
        onNavigateToTodo: (callback) => { if (typeof callback === 'function') panelListeners.navigate.push(callback); },
        exportPDF: async (html, title) => {
            const frame = document.createElement('iframe');
            frame.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:100vh;border:0;opacity:0;pointer-events:none;';
            document.body.appendChild(frame);
            const doc = frame.contentDocument;
            doc.open();
            doc.write(html);
            doc.close();
            const style = doc.createElement('style');
            style.textContent = '@page{size:A4;margin:14mm;}html,body{width:auto!important;max-width:100%;background:#fff;}img{max-width:100%;height:auto;}';
            doc.head.appendChild(style);
            doc.title = title || 'export';
            await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }))));
            await new Promise((resolve) => setTimeout(resolve, 60));
            const win = frame.contentWindow;
            const cleanup = () => { try { frame.remove(); } catch (e) {} };
            win.addEventListener('afterprint', cleanup);
            setTimeout(cleanup, 60000);
            win.focus();
            win.print();
            return { success: true };
        },
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => ({ success: false, error: '浏览器页面不能设置开机启动' }),
        checkUpdate: async () => {
            try {
                const res = await origFetch('https://api.github.com/repos/cornradio/rbtodo/releases/latest', {
                    headers: { Accept: 'application/vnd.github+json' }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                const latest = String(data.tag_name || data.name || '').replace(/^v/, '');
                return {
                    current: APP_VERSION,
                    latest,
                    hasUpdate: !!(latest && cmpVersion(latest, APP_VERSION) > 0),
                    url: data.html_url || 'https://github.com/cornradio/rbtodo/releases',
                    notes: data.body || ''
                };
            } catch (e) {
                return { error: e.message || 'check failed' };
            }
        },
        setZoomFactor: (factor) => {
            const z = Math.max(0.6, Math.min(2, Number(factor) || 1));
            // Scale the page by root font-size. CSS zoom splits mouse coordinates
            // from layout and offsets menus and drags. Ctrl+Plus is browser zoom
            // and would also enlarge every port on this host.
            const root = document.documentElement;
            root.style.zoom = '';
            root.style.fontSize = (16 * z) + 'px';
        },
        getZoomFactor: () => {
            const fs = parseFloat(document.documentElement.style.fontSize);
            return fs ? Math.round((fs / 16) * 10) / 10 : 1;
        },
        getAppVersion: async () => APP_VERSION,
        getReleaseNotes: async () => releaseNotes,
        exportImage: (html, title) => exportLongImage(html, title),
        exportMarkdown: async (md, images, title) => {
            const safe = String(title || 'export').replace(/[\\/:*?"<>|]/g, '_');
            const files = [{ name: safe + '.md', data: enc.encode(md || '') }];
            (images || []).forEach((img) => {
                if (!img || !img.filename) return;
                const bin = atob(img.base64 || '');
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                files.push({ name: 'images/' + img.filename, data: bytes });
            });
            if (files.length === 1) {
                saveBlob(new Blob([md || ''], { type: 'text/markdown;charset=utf-8' }), safe + '.md');
            } else {
                const zip = await zipFiles(files);
                saveBlob(new Blob([zip], { type: 'application/zip' }), safe + '.zip');
            }
            return { success: true };
        },
        getCustomThemeCSS: async () => {
            const name = state.settings.customThemeFile || 'default';
            return state.customThemes[name] || state.customThemes.default || DEFAULT_CUSTOM_THEME;
        },
        listCustomThemes: async () => Object.keys(state.customThemes).sort(),
        openCustomThemeFolder: async () => { openAssetEditor('theme'); return true; },
        setVibrancy: () => {},
        openHelp
    };

    installDomBridges();
    window.addEventListener('beforeunload', persistState);

    const ready = (async () => {
        try {
            db = await openDB();
            const saved = await idbGet('kv', 'state');
            if (saved) state = ensureDefaults(saved);
            else {
                try {
                    const backup = localStorage.getItem('rbtodo-offline-state');
                    if (backup) state = ensureDefaults(JSON.parse(backup));
                } catch (e) {}
            }
            const rows = await idbGetAll('uploads');
            rows.forEach((row) => {
                if (!row || !row.value) return;
                const bytes = row.value.buffer ? new Uint8Array(row.value.buffer) : new Uint8Array();
                uploadCache.set(row.key, { mime: row.value.mime || 'application/octet-stream', bytes });
            });
        } catch (err) {
            db = null;
            try {
                const backup = localStorage.getItem('rbtodo-offline-state');
                if (backup) state = ensureDefaults(JSON.parse(backup));
            } catch (e) {}
            console.warn('IndexedDB unavailable, using memory/localStorage', err);
        }
        try {
            const notesRes = await origFetch(new URL('RELEASE-NOTES.md', location.href));
            if (notesRes.ok) releaseNotes = await notesRes.text();
        } catch (e) {}
        if (!releaseNotes) releaseNotes = '# RBTodo ' + APP_VERSION + '\n\n离线页面与桌面快捷面板共用同一套界面。\n';
        persistState();
    })();

    window.RBTodoOffline = {
        ready,
        origin: ORIGIN,
        getState: () => state
    };
})();
