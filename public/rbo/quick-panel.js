        function localDateStr(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        let serverPort = null;
        let baseURL = '';
        function isLocalBase() {
            if (!baseURL) return true;
            try {
                const url = new URL(baseURL);
                if (url.origin === location.origin) return true;
                return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            } catch (e) {
                return String(baseURL).indexOf('localhost') !== -1;
            }
        }
        let todos = [];
        let projects = [];
        let currentProject = 'Default';
        let editingTodo = null;
        let saveTimer = null;
        let isDirty = false;
        let todayStr = localDateStr(new Date());
        let selectedDate = todayStr;

        function setEditorStatus(text, kind = '') {
            const el = document.getElementById('editor-status');
            if (!el) return;
            el.textContent = text;
            el.classList.remove('status-unsaved', 'status-saving', 'status-saved', 'status-error');
            if (kind) el.classList.add(kind);
        }

        function markDirty() {
            if (!editingTodo) return;
            isDirty = true;
            setEditorStatus('Unsaved', 'status-unsaved');
        }

        function clearDirty(statusText = 'Saved') {
            isDirty = false;
            setEditorStatus(statusText, statusText === 'Saved' ? 'status-saved' : '');
        }

        const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        function getWeekDates(offset) {
            offset = offset || 0;
            const now = new Date();
            const day = now.getDay();
            const monday = new Date(now);
            monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
            const dates = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                dates.push(localDateStr(d));
            }
            return dates;
        }

        let weekOffset = 0;
        let weekDates = getWeekDates(0);

        // --- Idle auto-hide ---
        // After N minutes of no mouse / keyboard activity, flush pending edits and hide the panel.
        // Avoids leaving a remote-connected instance writing stale data and racing other devices.
        let idleTimeoutMin = 5;
        let idleTimer = null;
        let idleHidePinned = false; // mirrors the pin button
        function armIdleTimer() {
            if (idleTimer) clearTimeout(idleTimer);
            if (!idleTimeoutMin || idleTimeoutMin <= 0) return;
            if (idleHidePinned) return; // never auto-hide when pinned
            idleTimer = setTimeout(async () => {
                try {
                    if (isDirty && typeof flushSave === 'function') await flushSave();
                } catch (e) {}
                try { window.electronAPI.hidePanel(); } catch (e) {}
            }, idleTimeoutMin * 60 * 1000);
        }
        ['mousemove','keydown','mousedown','wheel','touchstart'].forEach(evt => {
            document.addEventListener(evt, armIdleTimer, { passive: true });
        });
        (async () => {
            try {
                const v = await window.electronAPI.getSetting('idleHideMinutes');
                if (typeof v === 'number' && v >= 0) idleTimeoutMin = v;
            } catch (e) {}
            armIdleTimer();
        })();

        // --- UI zoom (⌘+ / ⌘- / ⌘0) ---
        let uiZoom = 1;
        function applyZoom(z) {
            uiZoom = Math.max(0.6, Math.min(2.0, Math.round(z * 10) / 10));
            window.electronAPI.setZoomFactor(uiZoom);
            const disp = document.getElementById('set-zoom-display');
            if (disp) disp.textContent = Math.round(uiZoom * 100) + '%';
        }
        async function loadZoom() {
            try {
                const z = await window.electronAPI.getSetting('uiZoom');
                if (typeof z === 'number' && z > 0) applyZoom(z);
            } catch (e) {}
        }
        async function setZoom(z) {
            applyZoom(z);
            try { await window.electronAPI.setSetting('uiZoom', uiZoom); } catch (e) {}
        }
        loadZoom();

        // Periodically check if the calendar day has rolled over.
        // When it has, show a one-time toast nudging the user to refresh with ⌘R.
        let dateRolloverNotified = false;
        function checkDateRollover() {
            const newToday = localDateStr(new Date());
            if (newToday === todayStr || dateRolloverNotified) return;
            dateRolloverNotified = true;
            showToast('新的一天，按 ⌘R 刷新日期');
        }
        setInterval(checkDateRollover, 60 * 1000); // check every minute

        function renderDayTabs() {
            const tabs = document.getElementById('day-tabs');
            let html = `<button class="day-tab ${selectedDate === 'overdue' ? 'active' : ''}" data-date="overdue">«</button>`;
            html += weekDates.map((date, i) => {
                const isToday = date === todayStr;
                const isActive = date === selectedDate;
                return `<button class="day-tab ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" data-date="${date}">${DAY_NAMES[i]}</button>`;
            }).join('');
            html += `<button class="day-tab ${selectedDate === 'future' ? 'active' : ''}" data-date="future">»</button>`;
            tabs.innerHTML = html;
            // Week offset badge
            const badge = document.getElementById('week-offset-badge');
            if (badge) {
                if (weekOffset !== 0) {
                    badge.style.display = 'inline-flex';
                    badge.innerHTML = `<span class="week-offset-label">[${weekOffset}]</span><button class="week-reset-btn" id="week-reset-btn" title="回到本周">↩</button>`;
                    document.getElementById('week-reset-btn').onclick = async () => {
                        await flushSave();
                        weekOffset = 0;
                        weekDates = getWeekDates(0);
                        selectedDate = todayStr;
                        renderDayTabs();
                        editingTodo = null;
                        document.getElementById('editor-empty').style.display = 'flex';
                        document.getElementById('editor-area').classList.remove('active');
                        updateEditorDateBar();
                        loadTodos();
                        updateTitle();
                    };
                } else {
                    badge.style.display = 'none';
                    badge.innerHTML = '';
                }
            }
        }

        document.getElementById('day-tabs').addEventListener('click', async (e) => {
            const tab = e.target.closest('.day-tab');
            if (tab) {
                await flushSave();
                selectedDate = tab.dataset.date;
                renderDayTabs();
                editingTodo = null;
                document.getElementById('editor-empty').style.display = 'flex';
                document.getElementById('editor-area').classList.remove('active');
                updateEditorDateBar();
                loadTodos();
                updateTitle();
            }
        });

        function updateTitle() {
            if (selectedDate === todayStr) {
                document.getElementById('panel-title').textContent = 'Today';
            } else if (selectedDate === 'overdue') {
                document.getElementById('panel-title').textContent = 'Overdue';
            } else if (selectedDate === 'future') {
                document.getElementById('panel-title').textContent = 'Future';
            } else {
                const d = new Date(selectedDate);
                document.getElementById('panel-title').textContent = `${d.getMonth()+1}/${d.getDate()}`;
            }
        }

        updateTitle();
        renderDayTabs();

        const ALL_THEMES = ['dark','light','dusk','ocean','forest','midnight','aurora','blossom','paper','cute','cyberpunk','wood','monokai','hc-black','hc-white','onedark','hub','glass-dark','glass-light','custom'];
        const LIGHT_THEMES = new Set(['light','blossom','paper','cute','hc-white','glass-light','hub']);
        async function applyTheme(t) {
            ALL_THEMES.forEach(c => document.body.classList.remove(c));
            if (t && t !== 'dark') document.body.classList.add(t);
            // Make native widgets (date picker, <select> popup, scrollbars) follow dark/light mode
            document.documentElement.style.colorScheme = LIGHT_THEMES.has(t) ? 'light' : 'dark';
            window.electronAPI.setVibrancy(t.startsWith('glass') ? 'under-window' : '');
            let customStyle = document.getElementById('custom-theme-style');
            if (t === 'custom') {
                const css = await window.electronAPI.getCustomThemeCSS();
                if (!customStyle) {
                    customStyle = document.createElement('style');
                    customStyle.id = 'custom-theme-style';
                    document.head.appendChild(customStyle);
                }
                customStyle.textContent = css;
            } else if (customStyle) {
                customStyle.textContent = '';
            }
        }

        async function init() {
            serverPort = await window.electronAPI.getServerPort();
            const remoteURL = await window.electronAPI.getSetting('remoteURL');
            const useRemote = await window.electronAPI.getSetting('useRemote');
            if (useRemote && remoteURL) {
                baseURL = remoteURL.replace(/\/$/, '');
                const remoteUser = await window.electronAPI.getSetting('remoteUser');
                const remotePass = await window.electronAPI.getSetting('remotePass');
                if (remoteUser && remotePass) {
                    authHeader = 'Basic ' + btoa(remoteUser + ':' + remotePass);
                    currentRemoteUser = remoteUser; currentRemotePass = remotePass;
                }
                pushAuthToMain();
                try {
                    const testRes = await fetch(baseURL + '/api/projects', { headers: headers(), signal: AbortSignal.timeout(5000) });
                    if (!testRes.ok) throw new Error(testRes.status);
                } catch (e) {
                    showToast('Remote unreachable (' + (e.message || 'timeout') + ') — using Local');
                    baseURL = location.origin;
                    authHeader = ''; currentRemoteUser = ''; currentRemotePass = '';
                    pushAuthToMain();
                    await window.electronAPI.setSetting('useRemote', false);
                }
            } else {
                baseURL = location.origin;
                authHeader = ''; currentRemoteUser = ''; currentRemotePass = '';
                pushAuthToMain();
            }
            if (!isLocalBase()) {
                document.getElementById('remote-badge').style.display = 'inline-block';
                document.getElementById('menu-open-url').textContent = '🌐 Open Remote URL';
            }
            const theme = (await window.electronAPI.getSetting('theme')) || 'dusk';
            applyTheme(theme);
            try {
                await loadProjects();
                await loadTodos();
            } catch (e) {
                console.warn('Server unreachable:', e.message);
                showToast('Server unreachable — check Settings');
            }
            window.electronAPI.onPanelShown(async () => {
                // Re-arm idle auto-hide timer whenever the panel is brought back
                armIdleTimer();
                // Catch up if the system slept across midnight
                checkDateRollover();
                const isRemote = !isLocalBase();
                // Do NOT auto-upload on show — that was racing remote edits.
                // Keep unsaved local edits; only pull when clean.
                if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                const hadDirty = isDirty;
                const dirtySnapshot = hadDirty && editingTodo ? {
                    id: editingTodo.id,
                    title: document.getElementById('editor-title').value,
                    content: stripImageUrls(getEditorHTML()),
                    completed: editingTodo.completed,
                    updatedAt: editingTodo.updatedAt
                } : null;

                await loadProjects();
                await loadTodos();
                // Re-sync editingTodo reference to the fresh todos[] array
                // (loadTodos replaces the array; editingTodo becomes orphan otherwise)
                if (editingTodo || dirtySnapshot) {
                    const keepId = dirtySnapshot?.id || editingTodo?.id;
                    const fresh = todos.find(t => t.id === keepId);
                    if (fresh) {
                        if (dirtySnapshot) {
                            // Preserve unsaved local edits
                            fresh.title = dirtySnapshot.title;
                            fresh.content = dirtySnapshot.content;
                            fresh.completed = dirtySnapshot.completed;
                            fresh.updatedAt = dirtySnapshot.updatedAt;
                            editingTodo = fresh;
                            document.getElementById('editor-title').value = fresh.title || '';
                            document.getElementById('editor-content').innerHTML = resolveImageUrls(fresh.content || '');
                            initCodeBlocks();
                            markDirty();
                        } else if (isRemote && (fresh.updatedAt || 0) > (editingTodo.updatedAt || 0)) {
                            editingTodo = fresh;
                            document.getElementById('editor-title').value = fresh.title || '';
                            document.getElementById('editor-content').innerHTML = resolveImageUrls(fresh.content || '');
                            initCodeBlocks();
                            clearDirty('Saved');
                            showToast('Refreshed from remote');
                        } else {
                            editingTodo = fresh;
                        }
                    } else if (!dirtySnapshot) {
                        editingTodo = null;
                        document.getElementById('editor-empty').style.display = 'flex';
                        document.getElementById('editor-area').classList.remove('active');
                        if (isRemote) showToast('Todo no longer exists on remote');
                    }
                }
            });
        }

        let authHeader = '';
        let currentRemoteUser = '', currentRemotePass = '';
        function pushAuthToMain() {
            let host = '';
            if (!isLocalBase()) {
                try { host = new URL(baseURL).host; } catch (e) {}
            }
            window.electronAPI.setRemoteAuth(currentRemoteUser, currentRemotePass, host);
        }
        function headers() {
            const h = { 'Content-Type': 'application/json', 'X-Project': currentProject };
            if (authHeader) h['Authorization'] = authHeader;
            return h;
        }

        // --- L/R toggle via title click ---
        document.getElementById('panel-title').style.cursor = 'pointer';
        document.getElementById('panel-title').addEventListener('click', async () => {
            const remoteURL = await window.electronAPI.getSetting('remoteURL');
            if (!remoteURL) { showToast('No remote URL configured'); return; }
            const isRemote = !isLocalBase();
            const oldProjKey = isRemote ? 'lastProject-remote' : 'lastProject-local';
            // 1) Flush pending in-memory edits to the CURRENT server BEFORE switching baseURL
            //    (otherwise old-side edits would be saved into the new side → data bleed)
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            await flushSave();
            await window.electronAPI.setSetting(oldProjKey, currentProject);
            // 2) Clear editor before switching (don't carry old-side todo into new context)
            editingTodo = null;
            document.getElementById('editor-empty').style.display = 'flex';
            document.getElementById('editor-area').classList.remove('active');
            // 3) Switch baseURL/auth
            if (isRemote) {
                baseURL = location.origin;
                authHeader = ''; currentRemoteUser = ''; currentRemotePass = '';
                pushAuthToMain();
                await window.electronAPI.setSetting('useRemote', false);
                document.getElementById('remote-badge').style.display = 'none';
                showToast('Switched to Local');
            } else {
                baseURL = remoteURL.replace(/\/$/, '');
                const remoteUser = await window.electronAPI.getSetting('remoteUser');
                const remotePass = await window.electronAPI.getSetting('remotePass');
                if (remoteUser && remotePass) {
                    authHeader = 'Basic ' + btoa(remoteUser + ':' + remotePass);
                    currentRemoteUser = remoteUser; currentRemotePass = remotePass;
                }
                pushAuthToMain();
                try {
                    const testRes = await fetch(baseURL + '/api/projects', { headers: headers(), signal: AbortSignal.timeout(5000) });
                    if (!testRes.ok) throw new Error(testRes.status);
                    await window.electronAPI.setSetting('useRemote', true);
                    document.getElementById('remote-badge').style.display = 'inline-block';
                    showToast('Switched to Remote');
                } catch (e) {
                    baseURL = location.origin;
                    authHeader = ''; currentRemoteUser = ''; currentRemotePass = '';
                    pushAuthToMain();
                    showToast('Remote unreachable — staying Local');
                    return;
                }
            }
            // 4) Load new side's project list (this sets currentProject from lastProject-{side})
            await loadProjects();
            // 5) Only switch server-side project if the project actually exists on the new side
            //    (avoid creating a phantom project that mirrors the other side's name)
            if (projects.includes(currentProject)) {
                await fetch(`${baseURL}/api/projects/switch`, {
                    method: 'POST', headers: headers(),
                    body: JSON.stringify({ name: currentProject })
                });
            }
            await loadTodos();
        });

        // --- Projects ---
        async function loadProjects() {
            try {
                const res = await fetch(`${baseURL}/api/projects`, { headers: headers() });
                const data = await res.json();
                projects = data.projects || [];
                const projKey = isLocalBase() ? 'lastProject-local' : 'lastProject-remote';
                const lastProject = await window.electronAPI.getSetting(projKey);
                if (lastProject && projects.includes(lastProject)) {
                    currentProject = lastProject;
                } else {
                    currentProject = data.currentProject || 'Default';
                }
                const sel = document.getElementById('project-select');
                sel.innerHTML = projects.map(p =>
                    `<option value="${p}" ${p === currentProject ? 'selected' : ''}>${p}</option>`
                ).join('');
            } catch (e) {}
        }

        document.getElementById('project-select').addEventListener('change', async (e) => {
            await flushSave();
            currentProject = e.target.value;
            const projKey = isLocalBase() ? 'lastProject-local' : 'lastProject-remote';
            window.electronAPI.setSetting(projKey, currentProject);
            await fetch(`${baseURL}/api/projects/switch`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ name: currentProject })
            });
            editingTodo = null;
            document.getElementById('editor-empty').style.display = 'flex';
            document.getElementById('editor-area').classList.remove('active');
            updateEditorDateBar();
            await loadTodos();
        });

        // --- Todos ---
        async function loadTodos() {
            try {
                let url;
                if (selectedDate === 'overdue') {
                    url = `${baseURL}/api/old-todos?date=${todayStr}`;
                } else if (selectedDate === 'future') {
                    url = `${baseURL}/api/future-todos?date=${todayStr}`;
                } else {
                    url = `${baseURL}/api/todos?date=${selectedDate}`;
                }
                const res = await fetch(url, { headers: headers() });
                const data = await res.json();
                todos = Array.isArray(data) ? data : (data.todos || []);
                renderList();
            } catch (e) {}
        }

        let optionHeld = false;

        function renderList() {
            const list = document.getElementById('task-list');
            const isToday = selectedDate === todayStr;
            const uncompletedCount = todos.filter(t => !t.completed).length;
            const showMoveBtn = !isToday && uncompletedCount > 0;
            if (todos.length === 0) {
                list.innerHTML = '<div class="empty">No tasks</div>';
                return;
            }
            const canDrag = selectedDate !== 'overdue' && selectedDate !== 'future';
            const tasksHtml = todos.map(t => `
                <div class="task-item ${t.completed ? 'completed' : ''} ${editingTodo?.id === t.id ? 'active' : ''}" data-id="${t.id}" ${canDrag ? 'draggable="true"' : ''}>
                    <div class="checkbox ${t.completed ? 'checked' : ''}" data-id="${t.id}"></div>
                    <span class="task-title">${esc(t.title || 'Untitled')}</span>
                    <button class="del-btn" data-id="${t.id}" style="display:${optionHeld ? 'inline-flex' : 'none'}">🗑</button>
                </div>
            `).join('');
            const moveBtnHtml = showMoveBtn ? `
                <div class="task-item move-today" id="move-to-today-btn" title="将 ${uncompletedCount} 项未完成任务移到今日">
                    <div class="checkbox">›</div>
                    <span class="task-title">将 ${uncompletedCount} 项未完成任务移到今日</span>
                </div>
            ` : '';
            list.innerHTML = tasksHtml + moveBtnHtml;
            if (showMoveBtn) {
                document.getElementById('move-to-today-btn').addEventListener('click', moveAllUncompletedToToday);
            }
        }

        async function moveAllUncompletedToToday() {
            // Flush pending edits and close editor before moving
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            if (editingTodo) {
                editingTodo.title = document.getElementById('editor-title').value;
                editingTodo.content = stripImageUrls(getEditorHTML());
                await saveTodo(editingTodo);
                editingTodo = null;
                document.getElementById('editor-empty').style.display = 'flex';
                document.getElementById('editor-area').classList.remove('active');
                updateEditorDateBar();
            }
            const targets = todos.filter(t => !t.completed);
            if (!targets.length) return;
            for (const t of targets) {
                const originalDate = t.date || selectedDate;
                if (originalDate === todayStr) continue;
                const newTodo = { ...t, date: undefined };
                await fetch(`${baseURL}/api/todos`, {
                    method: 'POST', headers: headers(),
                    body: JSON.stringify({ date: todayStr, todo: newTodo })
                });
                await fetch(`${baseURL}/api/todos/delete`, {
                    method: 'POST', headers: headers(),
                    body: JSON.stringify({ date: originalDate, id: t.id })
                });
            }
            showToast(`已移动 ${targets.length} 项到今日`);
            await loadTodos();
        }

        function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

        // --- Right-click context menu ---
        document.getElementById('task-list').addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.task-item');
            if (!item) return;
            e.preventDefault();
            const todo = todos.find(t => t.id === item.dataset.id);
            if (!todo) return;
            const existing = document.querySelector('.ctx-menu');
            if (existing) existing.remove();
            const menu = document.createElement('div');
            menu.className = 'ctx-menu';
            menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 12px var(--shadow);`;

            const mkItem = (label, danger) => {
                const it = document.createElement('div');
                it.className = 'ctx-item';
                it.textContent = label;
                it.style.cssText = `padding:6px 14px;font-size:12px;cursor:pointer;color:${danger ? 'var(--danger)' : 'var(--text)'};`;
                return it;
            };

            // --- Move to project submenu ---
            const otherProjects = projects.filter(p => p !== currentProject);
            if (otherProjects.length) {
                const moveItem = mkItem('Move to ▸');
                moveItem.style.position = 'relative';
                menu.appendChild(moveItem);
                // Build submenu lazily on hover
                moveItem.addEventListener('mouseenter', () => {
                    if (moveItem.querySelector('.ctx-submenu')) return;
                    const sub = document.createElement('div');
                    sub.className = 'ctx-submenu';
                    sub.style.cssText = `position:absolute;left:100%;top:-4px;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 12px var(--shadow);`;
                    otherProjects.forEach(p => {
                        const pi = mkItem(p);
                        pi.addEventListener('click', async (ev) => {
                            ev.stopPropagation();
                            menu.remove();
                            await moveTodoToProject(todo, p);
                        });
                        pi.addEventListener('mouseover', () => pi.style.background = 'rgba(255,255,255,0.08)');
                        pi.addEventListener('mouseout', () => pi.style.background = 'none');
                        sub.appendChild(pi);
                    });
                    moveItem.appendChild(sub);
                });
                moveItem.addEventListener('mouseleave', () => {
                    const sub = moveItem.querySelector('.ctx-submenu');
                    if (sub) setTimeout(() => sub.remove(), 80);
                });
            }

            // --- Move to Today ---
            const todoDate = todo.date || selectedDate;
            if (todoDate !== todayStr) {
                const todayItem = mkItem('Move to Today');
                todayItem.addEventListener('click', async () => {
                    menu.remove();
                    try {
                        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                        if (editingTodo && editingTodo.id === todo.id) await flushSave();
                        const originalDate = todo.date || selectedDate;
                        const newTodo = { ...todo, date: undefined };
                        await fetch(`${baseURL}/api/todos`, {
                            method: 'POST', headers: headers(),
                            body: JSON.stringify({ date: todayStr, todo: newTodo })
                        });
                        await fetch(`${baseURL}/api/todos/delete`, {
                            method: 'POST', headers: headers(),
                            body: JSON.stringify({ date: originalDate, id: todo.id })
                        });
                        if (editingTodo && editingTodo.id === todo.id) {
                            editingTodo = null;
                            document.getElementById('editor-empty').style.display = 'flex';
                            document.getElementById('editor-area').classList.remove('active');
                        }
                        await loadTodos();
                        showToast('已移动到今日');
                    } catch (err) {
                        showToast('移动失败: ' + err.message);
                    }
                });
                menu.appendChild(todayItem);
            }

            const delItem = mkItem('Delete', true);
            delItem.addEventListener('click', () => { menu.remove(); deleteTodo(todo); });
            menu.appendChild(delItem);

            menu.addEventListener('mouseover', (ev) => { if (ev.target.classList.contains('ctx-item') && !ev.target.querySelector('.ctx-submenu')) ev.target.style.background = 'rgba(255,255,255,0.08)'; });
            menu.addEventListener('mouseout', (ev) => { if (ev.target.classList.contains('ctx-item')) ev.target.style.background = 'none'; });
            document.body.appendChild(menu);
            const close = () => { menu.remove(); document.removeEventListener('click', close); };
            setTimeout(() => document.addEventListener('click', close), 0);
        });

        async function moveTodoToProject(todo, targetProject) {
            if (!todo || targetProject === currentProject) return;
            try {
                const date = todo.date || selectedDate;
                // Cancel any pending save for this todo first
                if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                if (editingTodo && editingTodo.id === todo.id) await flushSave();
                // Copy: POST to target project with X-Project header override
                const fullTodo = { ...todo, date: undefined };
                await fetch(`${baseURL}/api/todos`, {
                    method: 'POST',
                    headers: { ...headers(), 'X-Project': targetProject },
                    body: JSON.stringify({ date, todo: fullTodo })
                });
                // Delete from current project
                await fetch(`${baseURL}/api/todos/delete`, {
                    method: 'POST', headers: headers(),
                    body: JSON.stringify({ date, id: todo.id })
                });
                // If was editing, clear editor
                if (editingTodo && editingTodo.id === todo.id) {
                    editingTodo = null;
                    document.getElementById('editor-empty').style.display = 'flex';
                    document.getElementById('editor-area').classList.remove('active');
                }
                await loadTodos();
                showToast(`已移动到 "${targetProject}"`);
            } catch (e) {
                showToast('移动失败: ' + e.message);
            }
        }

        // --- Hold key to show delete buttons: Option/Alt on macOS, Shift on Windows ---
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        function isDeleteKey(e) { return isMac ? e.altKey : e.shiftKey; }

        // Strip zero-width / invisible chars from clipboard on copy/cut
        const ZW_RE = /[\u200B-\u200D\uFEFF\u2060]/g;
        function cleanCopy(e) {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            const target = e.target;
            if (target && (target.closest && target.closest('.cm-editor'))) return; // let CodeMirror handle its own
            const editorEl = document.getElementById('editor-content');
            let html = '', plain = '';
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                const div = document.createElement('div');
                div.appendChild(range.cloneContents());
                // Replace any .code-block in the selection with a clean <pre> containing the real code
                const origBlocks = editorEl ? [...editorEl.querySelectorAll('.code-block')] : [];
                div.querySelectorAll('.code-block').forEach(cloneBlock => {
                    const orig = origBlocks.find(b => b.contains(cloneBlock) || b.outerHTML === cloneBlock.outerHTML)
                        || origBlocks.find(b => b._cmView && cloneBlock.querySelector('.cm-editor'));
                    let code = '';
                    if (orig && orig._cmView) code = orig._cmView.state.doc.toString();
                    else code = [...cloneBlock.querySelectorAll('.cm-line')].map(l => l.textContent).join('\n');
                    const pre = document.createElement('pre');
                    pre.textContent = code;
                    cloneBlock.replaceWith(pre);
                });
                html = div.innerHTML.replace(ZW_RE, '');
                // For plain text: insert clone into DOM to get correct \n
                div.style.position = 'fixed';
                div.style.left = '-9999px';
                div.style.whiteSpace = 'pre-wrap';
                document.body.appendChild(div);
                plain = div.innerText.replace(ZW_RE, '');
                div.remove();
            } else {
                plain = sel.toString().replace(ZW_RE, '');
            }
            e.preventDefault();
            if (html) e.clipboardData.setData('text/html', html);
            e.clipboardData.setData('text/plain', plain);
            if (e.type === 'cut') {
                document.execCommand('delete');
            }
        }
        document.addEventListener('copy', cleanCopy);
        document.addEventListener('cut', cleanCopy);

        document.addEventListener('keydown', (e) => {
            if (isDeleteKey(e) && !optionHeld) {
                optionHeld = true;
                document.querySelectorAll('.del-btn').forEach(b => b.style.display = 'inline-flex');
            }
        });
        document.addEventListener('keyup', (e) => {
            if (!isDeleteKey(e) && optionHeld) {
                optionHeld = false;
                document.querySelectorAll('.del-btn').forEach(b => b.style.display = 'none');
            }
        });
        window.addEventListener('blur', () => {
            if (optionHeld) {
                optionHeld = false;
                document.querySelectorAll('.del-btn').forEach(b => b.style.display = 'none');
            }
        });

        // --- List clicks ---
        document.getElementById('task-list').addEventListener('click', async (e) => {
            const delBtn = e.target.closest('.del-btn');
            if (delBtn) {
                e.stopPropagation();
                const todo = todos.find(t => t.id === delBtn.dataset.id);
                if (todo) deleteTodo(todo);
                return;
            }
            const cb = e.target.closest('.checkbox');
            if (cb) {
                e.stopPropagation();
                const todo = todos.find(t => t.id === cb.dataset.id);
                if (todo) {
                    todo.completed = !todo.completed;
                    // Keep editingTodo's `completed` in sync so the next editor auto-save
                    // doesn't overwrite this change with stale data.
                    if (editingTodo && editingTodo.id === todo.id && editingTodo !== todo) {
                        editingTodo.completed = todo.completed;
                    }
                    await saveTodo(todo);
                    renderList();
                }
                return;
            }
            const item = e.target.closest('.task-item');
            if (item) {
                const todo = todos.find(t => t.id === item.dataset.id);
                if (todo) openEditor(todo);
            }
        });

        // --- Drag-to-reorder ---
        let draggedId = null;
        let dragIndicator = null;
        const taskList = document.getElementById('task-list');

        function removeDragIndicator() {
            if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
        }

        function getDropIndex(e) {
            const items = [...taskList.querySelectorAll('.task-item')];
            for (let i = 0; i < items.length; i++) {
                const rect = items[i].getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) return i;
            }
            return items.length;
        }

        taskList.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.task-item');
            if (!item) return;
            draggedId = item.dataset.id;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        taskList.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!draggedId) return;
            const dropIdx = getDropIndex(e);
            const items = [...taskList.querySelectorAll('.task-item')];
            const dragIdx = items.findIndex(el => el.dataset.id === draggedId);
            if (dropIdx === dragIdx || dropIdx === dragIdx + 1) { removeDragIndicator(); return; }

            removeDragIndicator();
            dragIndicator = document.createElement('div');
            dragIndicator.className = 'drag-indicator';
            if (dropIdx >= items.length) {
                taskList.appendChild(dragIndicator);
            } else {
                taskList.insertBefore(dragIndicator, items[dropIdx]);
            }
        });

        taskList.addEventListener('dragleave', (e) => {
            if (!taskList.contains(e.relatedTarget)) removeDragIndicator();
        });

        taskList.addEventListener('drop', async (e) => {
            e.preventDefault();
            removeDragIndicator();
            taskList.querySelectorAll('.task-item').forEach(el => el.classList.remove('dragging'));
            if (!draggedId) return;
            const dropIdx = getDropIndex(e);
            const fromIdx = todos.findIndex(t => t.id === draggedId);
            if (fromIdx === -1) { draggedId = null; return; }
            const adjustedIdx = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
            if (adjustedIdx === fromIdx) { draggedId = null; return; }
            const [moved] = todos.splice(fromIdx, 1);
            todos.splice(adjustedIdx, 0, moved);
            // Update in-memory order so subsequent renders/loads-from-cache stay consistent
            todos.forEach((t, i) => { t.order = i; });
            draggedId = null;
            renderList();
            try {
                await fetch(`${baseURL}/api/todos/order`, {
                    method: 'POST', headers: headers(),
                    body: JSON.stringify({ date: selectedDate, todos: todos.map(t => ({ id: t.id })) })
                });
            } catch (e) {}
        });

        taskList.addEventListener('dragend', () => {
            removeDragIndicator();
            taskList.querySelectorAll('.task-item').forEach(el => el.classList.remove('dragging'));
            draggedId = null;
        });

        // --- Editor ---
        function resolveImageUrls(html) {
            if (!html || !serverPort) return html;
            // Strip any old localhost:PORT references and any embedded creds, then add current
            html = html.replace(/src="https?:\/\/[^"\/]*\/uploads\//g, 'src="/uploads/');
            return html.replace(/src="\/uploads\//g, `src="${baseURL}/uploads/`);
        }

        function stripImageUrls(html) {
            if (!html) return html;
            return html.replace(/src="https?:\/\/[^"\/]*\/uploads\//g, 'src="/uploads/');
        }

        async function openEditor(todo) {
            // Same todo (by id) already open — do not reload from list (would lose unsaved edits)
            if (editingTodo && todo && editingTodo.id === todo.id) {
                document.getElementById('editor-content').focus();
                return;
            }
            if (editingTodo && editingTodo.id !== todo.id) {
                if (saveTimer) clearTimeout(saveTimer); saveTimer = null;
                if (isDirty) {
                    editingTodo.title = document.getElementById('editor-title').value;
                    editingTodo.content = stripImageUrls(getEditorHTML());
                    await saveTodo(editingTodo);
                    showToast('Saved');
                }
            }
            editingTodo = todo;
            isDirty = false;
            document.getElementById('editor-empty').style.display = 'none';
            document.getElementById('editor-area').classList.add('active');

            // Pull latest from server when opening (overwrite local cache for this note)
            try {
                const date = (todo.date || selectedDate || '').split(' ')[0];
                if (date && date !== 'overdue' && date !== 'future') {
                    const res = await fetch(`${baseURL}/api/todos?date=${date}`, { headers: headers() });
                    const data = await res.json();
                    const serverTodo = (data.todos || []).find(t => t.id === todo.id);
                    if (serverTodo) Object.assign(todo, serverTodo);
                }
            } catch (e) {
                console.warn('Download on open failed:', e);
            }

            document.getElementById('editor-title').value = todo.title || '';
            if (isZoomed) document.getElementById('zoom-title').textContent = todo.title || '';
            document.getElementById('editor-content').innerHTML = resolveImageUrls(todo.content || '');
            initCodeBlocks();
            clearDirty('Saved');
            updateEditorDateBar();
            renderList();
        }

        function flushSaveSync() {
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            if (!editingTodo || !isDirty) return;
            const todo = editingTodo;
            const title = document.getElementById('editor-title').value;
            const content = stripImageUrls(getEditorHTML());
            todo.title = title;
            todo.content = content;
            const date = todo.date || selectedDate;
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${baseURL}/api/todos`, false);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('X-Project', currentProject);
                if (authHeader) xhr.setRequestHeader('Authorization', authHeader);
                xhr.send(JSON.stringify({ date, todo }));
                isDirty = false;
            } catch (e) {
                // Fallback: use sendBeacon
                const blob = new Blob([JSON.stringify({ date, todo })], { type: 'application/json' });
                navigator.sendBeacon(`${baseURL}/api/todos?project=${encodeURIComponent(currentProject)}`, blob);
                isDirty = false;
            }
        }

        async function flushSave() {
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            if (!editingTodo) return;
            const todo = editingTodo;
            todo.title = document.getElementById('editor-title').value;
            // Use getEditorHTML() — serializes code blocks back to <pre> instead of CodeMirror DOM
            todo.content = stripImageUrls(getEditorHTML());
            setEditorStatus('Saving…', 'status-saving');
            try {
                await saveTodo(todo);
                clearDirty('Saved');
                renderList();
            } catch (e) {
                console.error(e);
                setEditorStatus('Error', 'status-error');
                throw e;
            }
        }

        async function manualSave() {
            if (!editingTodo) return;
            try {
                await flushSave();
                showToast('Saved');
            } catch (e) {
                showToast('Save failed');
            }
        }

        async function downloadCurrentNote() {
            if (!editingTodo) return;
            const btn = document.getElementById('btn-download');
            if (btn) btn.disabled = true;
            setEditorStatus('…', 'status-saving');
            try {
                const date = (editingTodo.date || selectedDate || '').split(' ')[0];
                const res = await fetch(`${baseURL}/api/todos?date=${date}`, { headers: headers() });
                const data = await res.json();
                const serverTodo = (data.todos || []).find(t => t.id === editingTodo.id);
                if (!serverTodo) {
                    showToast('Not on server yet — use Save');
                    setEditorStatus(isDirty ? 'Unsaved' : 'Saved', isDirty ? 'status-unsaved' : 'status-saved');
                    return;
                }
                Object.assign(editingTodo, serverTodo);
                const listItem = todos.find(t => t.id === editingTodo.id);
                if (listItem && listItem !== editingTodo) Object.assign(listItem, serverTodo);
                document.getElementById('editor-title').value = editingTodo.title || '';
                if (isZoomed) document.getElementById('zoom-title').textContent = editingTodo.title || '';
                document.getElementById('editor-content').innerHTML = resolveImageUrls(editingTodo.content || '');
                initCodeBlocks();
                clearDirty('Saved');
                renderList();
            } catch (e) {
                console.error(e);
                setEditorStatus('Error', 'status-error');
                showToast('Download failed');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async function closeEditor() {
            if (isDirty) await flushSave();
            editingTodo = null;
            isDirty = false;
            document.getElementById('editor-empty').style.display = 'flex';
            document.getElementById('editor-area').classList.remove('active');
            updateEditorDateBar();
            renderList();
        }

        // Local edits only — remote upload is manual via Save / ⌘S
        document.getElementById('editor-title').addEventListener('input', schedSave);
        document.getElementById('editor-title').addEventListener('input', (e) => {
            if (isZoomed) document.getElementById('zoom-title').textContent = e.target.value;
        });
        document.getElementById('editor-content').addEventListener('input', schedSave);
        document.getElementById('btn-download')?.addEventListener('click', () => downloadCurrentNote());
        document.getElementById('btn-save')?.addEventListener('click', () => manualSave());

        function syncCheckboxAttrs() {}
        function initCodeBlocks() {
            document.getElementById('editor-content').querySelectorAll('pre').forEach(pre => {
                const lang = pre.getAttribute('data-lang') || 'plain';
                const text = pre.textContent;
                const block = createCodeBlock(text, lang);
                pre.replaceWith(block);
            });
        }
        function getEditorHTML() {
            const editor = document.getElementById('editor-content');
            const blocks = editor.querySelectorAll('.code-block');
            const blockData = [...blocks].map(block => ({
                text: block._cmView ? block._cmView.state.doc.toString() : '',
                lang: block.querySelector('select')?.value || 'plain'
            }));
            const clone = editor.cloneNode(true);
            clone.querySelectorAll('.code-block').forEach((block, i) => {
                const pre = document.createElement('pre');
                pre.setAttribute('data-lang', blockData[i].lang);
                pre.textContent = blockData[i].text;
                block.replaceWith(pre);
            });
            return clone.innerHTML;
        }

        function isCodeBlockFocused() {
            const active = document.activeElement;
            return !!active?.closest?.('.code-block') || !!document.querySelector('.code-block .cm-focused');
        }
        function schedSave() {
            if (!editingTodo) return;
            // Keep in-memory todo in sync for list title, but do NOT upload.
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                if (!editingTodo) return;
                if (isCodeBlockFocused()) { schedSave(); return; }
                editingTodo.title = document.getElementById('editor-title').value;
                editingTodo.content = stripImageUrls(getEditorHTML());
                markDirty();
                renderList();
            }, 200);
            markDirty();
        }

        async function saveTodo(todo) {
            // Overwrite remote directly — never send expectedUpdatedAt (avoids CONFLICT merge).
            const date = todo.date || selectedDate;
            const res = await fetch(`${baseURL}/api/todos`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ date, todo })
            });
            if (!res.ok) throw new Error('save failed: ' + res.status);
            try {
                const r = await res.json();
                if (r && r.updatedAt) todo.updatedAt = r.updatedAt;
            } catch (e) {}
        }

        // Delete
        async function deleteTodo(todo) {
            if (!todo) return;
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            if (editingTodo && editingTodo.id === todo.id) {
                editingTodo = null;
                document.getElementById('editor-empty').style.display = 'flex';
                document.getElementById('editor-area').classList.remove('active');
                updateEditorDateBar();
            }
            await fetch(`${baseURL}/api/todos/delete`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ date: todo.date || selectedDate, id: todo.id })
            });
            await loadTodos();
        }

        // --- Toolbar ---
        // Restore last-used color from settings
        (async () => {
            try {
                const c = await window.electronAPI.getSetting('lastTextColor');
                if (c) {
                    document.getElementById('tb-color').value = c;
                    document.getElementById('tb-color-label').style.color = c;
                }
            } catch (e) {}
        })();
        document.getElementById('tb-color').addEventListener('input', (e) => {
            document.getElementById('editor-content').focus();
            document.execCommand('foreColor', false, e.target.value);
            document.getElementById('tb-color-label').style.color = e.target.value;
            window.electronAPI.setSetting('lastTextColor', e.target.value);
            schedSave();
        });
        // Right-click A → apply last-used color without opening picker
        let colorSavedRange = null;
        document.getElementById('tb-color-label').addEventListener('mousedown', (e) => {
            // Save selection BEFORE focus shifts to the label / native picker opens
            const sel = window.getSelection();
            if (sel && sel.rangeCount) colorSavedRange = sel.getRangeAt(0).cloneRange();
        });
        document.getElementById('tb-color-label').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const editor = document.getElementById('editor-content');
            editor.focus();
            if (colorSavedRange) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(colorSavedRange);
            }
            const color = document.getElementById('tb-color').value;
            document.execCommand('foreColor', false, color);
            schedSave();
        });
        let savedRange = null;
        document.getElementById('tb-clear-color').addEventListener('mousedown', (e) => {
            e.preventDefault();
            const sel = window.getSelection();
            if (sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
        });
        document.getElementById('tb-clear-color').addEventListener('click', (ev) => {
            const editor = document.getElementById('editor-content');
            editor.focus();
            const sel = window.getSelection();
            function extractPlainLines(container) {
                const clone = container.cloneNode(true);
                clone.querySelectorAll('.code-block').forEach(b => {
                    const pre = document.createElement('pre');
                    const origBlocks = editor.querySelectorAll('.code-block');
                    const idx = [...clone.querySelectorAll('.code-block')].indexOf(b);
                    if (idx >= 0 && origBlocks[idx] && origBlocks[idx]._cmView) {
                        pre.textContent = origBlocks[idx]._cmView.state.doc.toString();
                    }
                    b.replaceWith(pre);
                });
                clone.style.position = 'fixed';
                clone.style.left = '-9999px';
                clone.style.whiteSpace = 'pre-wrap';
                document.body.appendChild(clone);
                const text = clone.innerText;
                clone.remove();
                return text;
            }
            function cleanText(t) {
                // Replace non-breaking spaces (U+00A0) with regular spaces
                // Collapse multiple consecutive newlines into a single newline
                return t.replace(/ /g, ' ').replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '');
            }
            // Shift+click: clear entire note (preserve images)
            if (ev.shiftKey) {
                const clone = editor.cloneNode(true);
                // Stash <img> tags as placeholder text so they survive plain-text extraction
                const cloneImgs = [...clone.querySelectorAll('img')];
                const savedImgs = cloneImgs.map(im => im.outerHTML);
                cloneImgs.forEach((im, i) => {
                    im.replaceWith(document.createTextNode(`IMG_${i}`));
                });
                // Replace code blocks with plain <pre> (same as extractPlainLines does)
                const origBlocks = editor.querySelectorAll('.code-block');
                clone.querySelectorAll('.code-block').forEach((b, ci) => {
                    const pre = document.createElement('pre');
                    if (origBlocks[ci] && origBlocks[ci]._cmView) {
                        pre.textContent = origBlocks[ci]._cmView.state.doc.toString();
                    }
                    b.replaceWith(pre);
                });
                clone.style.position = 'fixed';
                clone.style.left = '-9999px';
                clone.style.whiteSpace = 'pre-wrap';
                document.body.appendChild(clone);
                const rawText = clone.innerText;
                clone.remove();
                const text = cleanText(rawText);
                const html = text.split('\n').map(line => {
                    const escaped = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    // Restore image tags from placeholders
                    const restored = escaped.replace(/IMG_(\d+)/g, (_, i) => savedImgs[parseInt(i, 10)] || '');
                    return restored || '<br>';
                }).join('</div><div>');
                editor.innerHTML = `<div>${html}</div>`;
                schedSave();
                return;
            }
            if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            if (range.collapsed) return;
            const frag = range.cloneContents();
            const tmp = document.createElement('div');
            tmp.appendChild(frag);
            const text = cleanText(extractPlainLines(tmp));
            const html = text.split('\n').map(line => {
                const escaped = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return escaped || '<br>';
            }).join('</div><div>');
            range.deleteContents();
            document.execCommand('insertHTML', false, `<div>${html}</div>`);
            schedSave();
        });
        document.getElementById('tb-checkbox').addEventListener('click', () => {
            const editor = document.getElementById('editor-content');
            editor.focus();
            const sel = window.getSelection();
            const raw = sel.toString();
            const CB = '<span class="cb">🔲</span> ';
            const escapeHtml = (str) => str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            if (raw && raw.includes('\n')) {
                const html = raw.split('\n').map(line => `<div>${CB}${escapeHtml(line)}</div>`).join('');
                document.execCommand('insertHTML', false, html);
            } else if (raw) {
                document.execCommand('insertHTML', false, CB + escapeHtml(raw));
            } else {
                document.execCommand('insertHTML', false, CB);
            }
            schedSave();
        });
        document.getElementById('tb-numlist').addEventListener('click', () => {
            const editor = document.getElementById('editor-content');
            editor.focus();
            const sel = window.getSelection();
            const raw = sel.toString();
            if (raw && raw.includes('\n')) {
                const lines = raw.split('\n');
                const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
                document.execCommand('insertText', false, numbered);
            } else if (raw) {
                document.execCommand('insertText', false, '1. ' + raw);
            } else {
                document.execCommand('insertText', false, '1. ');
            }
            schedSave();
        });

        // --- Emoji picker ---
        const DEFAULT_EMOJIS = ['😀','😂','🥲','😊','😍','🤔','😴','😭','😡','🥳','🤯','😎','🤝','👍','👎','👏','🙏','💪','✌️','🫡','❤️','💔','🔥','✨','⭐','🎉','🎁','💡','⚡','✅','❌','⚠️','📌','📝','📅','📞','📧','💻','🖥️','📱','☕','🍕','🍔','🍣','🍺','🚀','🏃','🐶','🐱','🌈','🌞','🌙','⛅','☔','🎵','📷','🔔','💰','🛒'];
        let savedRangeEmoji = null;
        async function getEmojiList() {
            const saved = await window.electronAPI.getSetting('emojiList');
            if (Array.isArray(saved) && saved.length) return saved;
            if (typeof saved === 'string' && saved.trim()) {
                return [...saved].filter(c => c.trim());
            }
            return DEFAULT_EMOJIS;
        }
        async function openEmojiPicker() {
            let panel = document.querySelector('.emoji-panel');
            if (panel) { panel.remove(); return; }
            const emojis = await getEmojiList();
            panel = document.createElement('div');
            panel.className = 'emoji-panel';
            panel.style.cssText = 'position:absolute;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,0.3);width:360px;max-height:280px;overflow-y:auto;';
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,1fr);gap:2px;';
            emojis.forEach(em => {
                const b = document.createElement('button');
                b.textContent = em;
                b.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;padding:4px;border-radius:4px;';
                b.addEventListener('mouseenter', () => b.style.background = 'var(--hover-bg, rgba(255,255,255,0.1))');
                b.addEventListener('mouseleave', () => b.style.background = 'none');
                b.addEventListener('mousedown', (e) => e.preventDefault());
                b.addEventListener('click', () => {
                    const editor = document.getElementById('editor-content');
                    editor.focus();
                    if (savedRangeEmoji) {
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(savedRangeEmoji);
                    }
                    document.execCommand('insertText', false, em);
                    // Update savedRange to new cursor position so multiple inserts work
                    const sel2 = window.getSelection();
                    if (sel2.rangeCount) savedRangeEmoji = sel2.getRangeAt(0).cloneRange();
                    schedSave();
                });
                grid.appendChild(b);
            });
            panel.appendChild(grid);
            const toolbar = document.querySelector('.editor-toolbar');
            toolbar.style.position = 'relative';
            const btn = document.getElementById('tb-emoji');
            const rect = btn.getBoundingClientRect();
            const tbRect = toolbar.getBoundingClientRect();
            const editorArea = document.getElementById('editor-area');
            const eaRect = editorArea.getBoundingClientRect();
            let left = rect.left - tbRect.left;
            // Clamp so panel doesn't overflow right edge
            const maxLeft = eaRect.width - 360 - 8;
            if (left > maxLeft) left = Math.max(0, maxLeft);
            panel.style.left = left + 'px';
            panel.style.top = (rect.bottom - tbRect.top + 4) + 'px';
            toolbar.appendChild(panel);
            const closer = (e) => { if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { panel.remove(); toolbar.style.position = ''; document.removeEventListener('mousedown', closer); } };
            setTimeout(() => document.addEventListener('mousedown', closer), 0);
        }
        (() => {
            const btn = document.getElementById('tb-emoji');
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel.rangeCount) savedRangeEmoji = sel.getRangeAt(0).cloneRange();
            });
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openEmojiPicker();
            });
        })();

        // --- Datetime insert ---
        const DEFAULT_DT_FORMAT = 'YYYY-MM-DD HH:mm:ss';
        function formatDateTime(fmt) {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const map = {
                YYYY: d.getFullYear(),
                MM: pad(d.getMonth() + 1),
                DD: pad(d.getDate()),
                HH: pad(d.getHours()),
                mm: pad(d.getMinutes()),
                ss: pad(d.getSeconds())
            };
            return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, m => map[m]);
        }
        (() => {
            const btn = document.getElementById('tb-datetime');
            let savedRangeDT = null;
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel.rangeCount) savedRangeDT = sel.getRangeAt(0).cloneRange();
            });
            btn.addEventListener('click', async () => {
                const editor = document.getElementById('editor-content');
                editor.focus();
                if (savedRangeDT) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(savedRangeDT);
                }
                const fmt = (await window.electronAPI.getSetting('dateTimeFormat')) || DEFAULT_DT_FORMAT;
                document.execCommand('insertText', false, formatDateTime(fmt));
                schedSave();
            });
        })();

        // --- Custom JS insert ---
        (async () => {
            const enabled = await window.electronAPI.getSetting('customJsEnabled');
            if (enabled) document.getElementById('tb-custom').style.display = '';
        })();
        let savedRangeCustom = null;
        function restoreCustomRange() {
            const editor = document.getElementById('editor-content');
            editor.focus();
            if (savedRangeCustom) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedRangeCustom);
            }
        }
        async function runCustomJs(name) {
            const editor = document.getElementById('editor-content');
            restoreCustomRange();
            try {
                const code = await window.electronAPI.getCustomJs(name);
                if (!code) { showToast('Empty script'); return; }
                const selection = (savedRangeCustom ? savedRangeCustom.toString() : '') || window.getSelection().toString();
                const insert = (text) => { restoreCustomRange(); document.execCommand('insertText', false, text); const s = window.getSelection(); if (s.rangeCount) savedRangeCustom = s.getRangeAt(0).cloneRange(); };
                const insertHTML = (html) => { restoreCustomRange(); document.execCommand('insertHTML', false, html); const s = window.getSelection(); if (s.rangeCount) savedRangeCustom = s.getRangeAt(0).cloneRange(); };
                const result = (new Function('editor', 'insert', 'insertHTML', 'selection', code))(editor, insert, insertHTML, selection);
                if (result && typeof result.then === 'function') await result;
                schedSave();
            } catch (e) {
                showToast('Custom JS error: ' + e.message);
            }
        }
        (() => {
            const btn = document.getElementById('tb-custom');
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel.rangeCount && document.getElementById('editor-content').contains(sel.anchorNode)) {
                    savedRangeCustom = sel.getRangeAt(0).cloneRange();
                }
            });
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                window.electronAPI.openCustomJsFolder();
                showToast('Opening custom-js folder');
            });
            btn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const existing = document.querySelector('.custom-js-menu');
                if (existing) { existing.remove(); return; }
                const files = await window.electronAPI.listCustomJs();
                if (!files.length) { showToast('No scripts. Edit folder via Settings.'); return; }
                if (files.length === 1) { await runCustomJs(files[0]); return; }
                const menu = document.createElement('div');
                menu.className = 'custom-js-menu';
                menu.style.cssText = 'position:absolute;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 12px var(--shadow);z-index:10000;';
                files.forEach(f => {
                    const item = document.createElement('div');
                    item.textContent = f;
                    item.style.cssText = 'padding:5px 12px;font-size:12px;cursor:pointer;color:var(--text);';
                    item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover, rgba(255,255,255,0.08))');
                    item.addEventListener('mouseleave', () => item.style.background = 'none');
                    item.addEventListener('click', async () => { menu.remove(); await runCustomJs(f); });
                    menu.appendChild(item);
                });
                const toolbar = document.querySelector('.editor-toolbar');
                toolbar.style.position = 'relative';
                const rect = btn.getBoundingClientRect();
                const tbRect = toolbar.getBoundingClientRect();
                menu.style.right = (tbRect.right - rect.right) + 'px';
                menu.style.top = (rect.bottom - tbRect.top + 4) + 'px';
                toolbar.appendChild(menu);
                const closer = (e) => { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); toolbar.style.position = ''; document.removeEventListener('mousedown', closer); } };
                setTimeout(() => document.addEventListener('mousedown', closer), 0);
            });
        })();

        const langExts = {
            javascript: CM.javascript, python: CM.python, html: CM.html, css: CM.css, json: CM.json, plain: () => []
        };
        function createCodeBlock(initialText, lang) {
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block';
            wrapper.contentEditable = 'false';
            const bar = document.createElement('div');
            bar.className = 'code-block-bar';
            const select = document.createElement('select');
            ['plain','javascript','python','html','css','json'].forEach(l => {
                const opt = document.createElement('option');
                opt.value = l; opt.textContent = l; if (l === lang) opt.selected = true;
                select.appendChild(opt);
            });
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            const delBtn = document.createElement('button');
            delBtn.textContent = '🗑'; delBtn.style.color = 'var(--danger, #e55)';
            bar.appendChild(select);
            const btnGroup = document.createElement('span');
            btnGroup.appendChild(copyBtn); btnGroup.appendChild(delBtn);
            bar.appendChild(btnGroup);
            wrapper.appendChild(bar);
            const cmDiv = document.createElement('div');
            wrapper.appendChild(cmDiv);
            const getLang = (l) => langExts[l] ? langExts[l]() : [];
            const view = new CM.EditorView({
                state: CM.EditorState.create({
                    doc: initialText || '',
                    extensions: [
                        CM.lineNumbers(),
                        CM.highlightActiveLineGutter(),
                        CM.highlightSpecialChars(),
                        CM.drawSelection(),
                        CM.bracketMatching(),
                        CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
                        CM.oneDark,
                        CM.keymap.of([...CM.defaultKeymap, CM.indentWithTab]),
                        getLang(lang || 'plain'),
                        CM.EditorView.updateListener.of(u => { if (u.docChanged) schedSave(); })
                    ]
                }),
                parent: cmDiv
            });
            wrapper._cmView = view;
            select.addEventListener('change', () => {
                const newLang = select.value;
                const doc = view.state.doc.toString();
                view.destroy();
                const newView = new CM.EditorView({
                    state: CM.EditorState.create({
                        doc,
                        extensions: [
                            CM.lineNumbers(), CM.highlightActiveLineGutter(), CM.highlightSpecialChars(),
                            CM.drawSelection(), CM.bracketMatching(),
                            CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
                            CM.oneDark,
                            CM.keymap.of([...CM.defaultKeymap, CM.indentWithTab]),
                            getLang(newLang),
                            CM.EditorView.updateListener.of(u => { if (u.docChanged) schedSave(); })
                        ]
                    }),
                    parent: cmDiv
                });
                wrapper._cmView = newView;
                schedSave();
            });
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(view.state.doc.toString());
                copyBtn.textContent = '✓'; setTimeout(() => copyBtn.textContent = 'Copy', 1000);
            });
            delBtn.addEventListener('click', () => {
                const editor = document.getElementById('editor-content');
                editor.focus();
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNode(wrapper);
                sel.removeAllRanges();
                sel.addRange(range);
                const ok = document.execCommand('delete');
                if (!ok || editor.contains(wrapper)) {
                    wrapper.remove();
                }
                schedSave();
            });
            return wrapper;
        }
        let lastActiveCodeBlock = null;
        document.addEventListener('focusin', (e) => {
            const cb = e.target.closest && e.target.closest('.code-block');
            if (cb) lastActiveCodeBlock = cb;
        });
        document.getElementById('tb-code').addEventListener('mousedown', (e) => {
            e.preventDefault(); // prevent focus shift — keeps activeElement on the code block
            const ae = document.activeElement;
            const cb = ae && ae.closest && ae.closest('.code-block');
            if (cb) lastActiveCodeBlock = cb;
            else lastActiveCodeBlock = null;
        });
        document.getElementById('tb-code').addEventListener('click', () => {
            const editor = document.getElementById('editor-content');
            const activeCm = lastActiveCodeBlock && editor.contains(lastActiveCodeBlock) ? lastActiveCodeBlock : null;
            lastActiveCodeBlock = null;
            if (activeCm && activeCm._cmView) {
                const code = activeCm._cmView.state.doc.toString();
                const lines = code.split('\n').map(l => {
                    const esc = l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    return `<div>${esc || '<br>'}</div>`;
                }).join('');
                const tmp = document.createElement('div');
                tmp.innerHTML = lines;
                const frag = document.createDocumentFragment();
                while (tmp.firstChild) frag.appendChild(tmp.firstChild);
                activeCm._cmView.destroy();
                activeCm.replaceWith(frag);
                editor.focus();
                schedSave();
                return;
            }
            editor.focus();
            const sel = window.getSelection();
            const text = sel.toString();
            const block = createCodeBlock(text, 'plain');
            const afterDiv = document.createElement('div');
            afterDiv.innerHTML = '<br>';
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(afterDiv);
                range.insertNode(block);
            } else {
                editor.appendChild(block);
                editor.appendChild(afterDiv);
            }
            block._cmView.focus();
            schedSave();
        });
        document.getElementById('editor-content').addEventListener('click', (e) => {
            // Don't treat clicks on images/links as checkbox clicks even if they happen to be nested
            if (e.target.tagName === 'IMG' || e.target.tagName === 'A') return;
            const cb = e.target.closest('.cb');
            if (!cb) return;
            // Only toggle if the .cb truly contains a checkbox emoji (and nothing else like an img)
            const txt = cb.textContent.trim();
            if (txt !== '🔲' && txt !== '✅') return;
            if (cb.querySelector('img,a')) return;
            cb.textContent = txt === '🔲' ? '✅' : '🔲';
            schedSave();
        });
        function wrapBareCheckboxes() {
            const editor = document.getElementById('editor-content');
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            const toReplace = [];
            let node;
            while ((node = walker.nextNode())) {
                if (node.parentElement?.classList?.contains('cb')) continue;
                if (/[🔲✅]/u.test(node.textContent)) toReplace.push(node);
            }
            toReplace.forEach(tn => {
                const frag = document.createDocumentFragment();
                const parts = tn.textContent.split(/([🔲✅])/u);
                parts.forEach(p => {
                    if (p === '🔲' || p === '✅') {
                        const span = document.createElement('span');
                        span.className = 'cb';
                        span.textContent = p;
                        frag.appendChild(span);
                    } else if (p) {
                        frag.appendChild(document.createTextNode(p));
                    }
                });
                tn.parentNode.replaceChild(frag, tn);
            });
        }
        document.getElementById('editor-content').addEventListener('input', wrapBareCheckboxes);
        document.getElementById('editor-content').addEventListener('keydown', (e) => {
            // Prevent backspace/delete from eating code blocks
            if (e.key === 'Backspace' || e.key === 'Delete') {
                const sel = window.getSelection();
                if (sel.isCollapsed) {
                    const editor = document.getElementById('editor-content');
                    const line = getLineNode(editor, sel);
                    if (e.key === 'Backspace' && line?.previousSibling?.classList?.contains('code-block')) {
                        if (sel.anchorOffset === 0 || (sel.anchorNode === line && sel.anchorOffset === 0)) {
                            e.preventDefault(); return;
                        }
                    }
                    if (e.key === 'Delete' && line?.nextSibling?.classList?.contains('code-block')) {
                        const node = sel.anchorNode;
                        const atEnd = node.nodeType === 3 ? sel.anchorOffset === node.textContent.length : true;
                        if (atEnd) { e.preventDefault(); return; }
                    }
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                insertLink();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel.rangeCount) savedRangeEmoji = sel.getRangeAt(0).cloneRange();
                openEmojiPicker();
                return;
            }
            // ⌘⇧V / Ctrl+Shift+V — paste as plain text
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                (async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (!text) return;
                        const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                        const html = text.split('\n').map(l => `<div>${escapeHtml(l) || '<br>'}</div>`).join('');
                        document.getElementById('editor-content').focus();
                        document.execCommand('insertHTML', false, html);
                        schedSave();
                    } catch (err) { showToast('Paste failed: ' + err.message); }
                })();
                return;
            }
            // Enter: auto-continue numbered list "N. ..."
            // Skip when IME composition is active (Chinese input method commit, etc.)
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.isComposing && e.keyCode !== 229) {
                const sel = window.getSelection();
                if (sel.isCollapsed) {
                    const editor = document.getElementById('editor-content');
                    const line = getLineNode(editor, sel);
                    if (line) {
                        const text = line.textContent || '';
                        const m = text.match(/^(\d+)\.\s/);
                        if (m) {
                            if (text.trim() === m[0].trim()) {
                                // Empty "N. " line — exit list: clear current line's prefix, keep cursor here
                                e.preventDefault();
                                line.innerHTML = '<br>';
                                const r = document.createRange();
                                r.setStart(line, 0);
                                r.collapse(true);
                                sel.removeAllRanges();
                                sel.addRange(r);
                                return;
                            }
                            // Let Enter happen naturally (creates new line), then add next number
                            const next = parseInt(m[1], 10) + 1;
                            requestAnimationFrame(() => {
                                document.execCommand('insertText', false, `${next}. `);
                            });
                            return;
                        }
                    }
                }
            }
            // Tab / Shift+Tab indent
            if (e.key === 'Tab') {
                e.preventDefault();
                const sel = window.getSelection();
                if (!sel.rangeCount) return;
                const editor = document.getElementById('editor-content');
                const indent = '    ';
                const indentRe = /^( {1,4}| {1,4}|\t)/;
                if (!e.shiftKey && sel.getRangeAt(0).collapsed) {
                    document.execCommand('insertText', false, indent);
                } else {
                    const lines = getSelectedLines(editor, sel);
                    lines.forEach(line => {
                        if (e.shiftKey) {
                            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                            const first = walker.nextNode();
                            if (first) first.textContent = first.textContent.replace(indentRe, '');
                        } else {
                            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                            const first = walker.nextNode();
                            if (first) first.textContent = indent + first.textContent;
                            else line.insertBefore(document.createTextNode(indent), line.firstChild);
                        }
                    });
                }
                schedSave();
                return;
            }
            // Cmd+C copy whole line when no selection
            if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !e.shiftKey) {
                const sel = window.getSelection();
                if (sel.isCollapsed) {
                    e.preventDefault();
                    const line = getLineNode(document.getElementById('editor-content'), sel);
                    if (line) {
                        const r = document.createRange();
                        r.selectNodeContents(line);
                        sel.removeAllRanges();
                        sel.addRange(r);
                        document.execCommand('copy');
                        sel.collapseToEnd();
                    }
                    return;
                }
            }
            // Cmd+X cut whole line when no selection
            if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !e.shiftKey) {
                const sel = window.getSelection();
                if (sel.isCollapsed) {
                    e.preventDefault();
                    const editor = document.getElementById('editor-content');
                    const line = getLineNode(editor, sel);
                    if (line && line !== editor) {
                        const r = document.createRange();
                        r.selectNode(line);
                        sel.removeAllRanges();
                        sel.addRange(r);
                        document.execCommand('cut');
                        schedSave();
                    }
                    return;
                }
            }
        });
        function getLineNode(editor, sel) {
            let node = sel.anchorNode;
            if (!node) return null;
            if (node === editor) return editor.childNodes[sel.anchorOffset] || editor.lastChild;
            while (node && node.parentNode !== editor) node = node.parentNode;
            return node;
        }
        function getSelectedLines(editor, sel) {
            const range = sel.getRangeAt(0);
            if (range.collapsed) {
                const line = getLineNode(editor, sel);
                return line ? [line] : [];
            }
            let start = range.startContainer, end = range.endContainer;
            while (start && start !== editor && start.parentNode !== editor) start = start.parentNode;
            while (end && end !== editor && end.parentNode !== editor) end = end.parentNode;
            if (!start || !end || start === editor || end === editor) return [];
            const lines = [];
            let cur = start;
            while (cur) {
                lines.push(cur);
                if (cur === end) break;
                cur = cur.nextSibling;
            }
            return lines;
        }
        function insertLink() {
            const sel = window.getSelection();
            const editorContent = document.getElementById('editor-content');
            if (!editorContent.contains(sel.anchorNode)) { editorContent.focus(); }
            const savedRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
            const selectedText = savedRange ? savedRange.toString() : '';

            const existing = document.getElementById('link-input-bar');
            if (existing) { existing.remove(); return; }

            const bar = document.createElement('div');
            bar.id = 'link-input-bar';
            bar.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 14px;border-top:1px solid var(--border-light);flex-shrink:0;';
            bar.innerHTML = `<span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">URL:</span><input id="link-url-input" style="flex:1;padding:3px 8px;background:var(--bg-input);border:1px solid var(--border-strong);border-radius:4px;color:var(--text-bright);font-size:12px;outline:none;" placeholder="https://..." value=""><button id="link-ok" style="padding:3px 10px;background:#0a84ff;border:none;border-radius:4px;color:#fff;font-size:11px;cursor:pointer;">OK</button>`;
            const editorArea = document.querySelector('.editor-area');
            const footer = document.querySelector('.editor-footer');
            editorArea.insertBefore(bar, footer);

            const inp = document.getElementById('link-url-input');
            inp.focus();

            const doInsert = () => {
                const url = inp.value.trim();
                bar.remove();
                if (!url) return;
                editorContent.focus();
                if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); }
                if (selectedText) {
                    document.execCommand('createLink', false, url);
                } else {
                    document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
                }
                schedSave();
            };
            document.getElementById('link-ok').onclick = doInsert;
            inp.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); doInsert(); }
                if (e.key === 'Escape') { e.preventDefault(); bar.remove(); editorContent.focus(); if (savedRange) { sel.removeAllRanges(); sel.addRange(savedRange); } }
            });
        }
        document.getElementById('tb-link').addEventListener('click', insertLink);
        document.getElementById('tb-img').addEventListener('click', () => {
            window.electronAPI.lockBlur();
            document.getElementById('img-upload').click();
        });

        // Make links clickable with Cmd/Ctrl+Click or middle-click
        function openLink(link) {
            const href = link.getAttribute('href') || link.href;
            if (href.startsWith('file://')) {
                window.electronAPI.openPath(href.replace('file://', ''));
            } else {
                window.electronAPI.openExternal(href);
            }
        }
        document.getElementById('editor-content').addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link) {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) openLink(link);
            }
        });
        document.getElementById('editor-content').addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                const link = e.target.closest('a');
                if (link) { e.preventDefault(); openLink(link); }
            }
        });
        document.getElementById('editor-content').addEventListener('click', (e) => {
            const img = e.target.closest('img');
            if (img && (e.metaKey || e.ctrlKey || e.detail === 2)) {
                e.preventDefault();
                showImageLightbox(img.src);
            }
        });
        document.getElementById('editor-content').addEventListener('mouseover', (e) => {
            const link = e.target.closest('a');
            if (link) link.title = '⌘+Click to open';
            const img = e.target.closest('img');
            if (img) img.title = 'Double-click or ⌘+Click to view';
        });

        function showImageLightbox(src) {
            window.electronAPI.lockBlur();
            window.electronAPI.openImageViewer(src);
        }

        // --- Right-click on image: context menu ---
        // --- Create Todo from selected text ---
        async function createTodoFromText(text, sourceTodo) {
            const date = (selectedDate === 'overdue' || selectedDate === 'future') ? todayStr : selectedDate;
            let contentHtml = '';
            if (sourceTodo) {
                const srcTitle = sourceTodo.title || 'Untitled';
                const srcIdShort = (sourceTodo.id || '').substring(0, 8);
                contentHtml += `<p style="color:var(--text-muted);font-size:12px;border-bottom:1px solid var(--border-light);padding-bottom:6px;margin-bottom:8px;">📎 创建自「${srcTitle.replace(/</g,'&lt;')}」<span style="opacity:0.6">(ID: ${srcIdShort})</span></p>`;
            }
            contentHtml += '<p>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g, '<br>') + '</p>';
            const newTodo = {
                id: crypto.randomUUID(),
                title: text.substring(0, 200),
                content: contentHtml,
                completed: false,
                date: date,
                order: todos.length,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await saveTodo(newTodo);
            await loadTodos();
            const created = todos.find(t => t.id === newTodo.id);
            if (created) openEditor(created);
            showToast('已创建 Todo');
        }

        document.getElementById('editor-content').addEventListener('contextmenu', (e) => {
            // --- Link right-click menu ---
            const link = e.target.closest('a');
            if (link) {
                e.preventDefault();
                document.querySelectorAll('.link-ctx-menu').forEach(m => m.remove());
                const href = link.getAttribute('href') || '';
                const menu = document.createElement('div');
                menu.className = 'link-ctx-menu';
                menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 12px var(--shadow);`;
                const mkLinkItem = (label, onClick, danger) => {
                    const it = document.createElement('div');
                    it.textContent = label;
                    it.style.cssText = `padding:6px 14px;font-size:12px;cursor:pointer;color:${danger ? 'var(--danger)' : 'var(--text)'};`;
                    it.addEventListener('mouseenter', () => it.style.background = 'rgba(255,255,255,0.08)');
                    it.addEventListener('mouseleave', () => it.style.background = 'none');
                    it.addEventListener('click', () => { menu.remove(); onClick(); });
                    return it;
                };
                menu.appendChild(mkLinkItem('Copy Link', () => {
                    navigator.clipboard.writeText(href);
                    showToast('Link copied');
                }));
                menu.appendChild(mkLinkItem('Open Link', () => {
                    window.electronAPI.openExternal(href);
                }));
                menu.appendChild(mkLinkItem('Remove Link', () => {
                    const text = document.createTextNode(link.textContent);
                    link.replaceWith(text);
                    schedSave();
                }, true));
                document.body.appendChild(menu);
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 0);
                return;
            }

            // Get selected text for "Create Todo" feature
            const sel = window.getSelection();
            const selectedText = sel ? sel.toString().trim() : '';

            // --- Image right-click menu ---
            const img = e.target.closest('img');
            if (!img && !selectedText) return;
            e.preventDefault();

            const mkCtxItem = (menuEl) => (label, onClick, danger) => {
                const it = document.createElement('div');
                it.textContent = label;
                it.style.cssText = `padding:6px 14px;font-size:12px;cursor:pointer;color:${danger ? 'var(--danger)' : 'var(--text)'};`;
                it.addEventListener('mouseenter', () => it.style.background = 'rgba(255,255,255,0.08)');
                it.addEventListener('mouseleave', () => it.style.background = 'none');
                it.addEventListener('click', () => { menuEl.remove(); onClick(); });
                return it;
            };
            const menuBase = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 4px 12px var(--shadow);`;
            const attachClose = (menu) => {
                document.body.appendChild(menu);
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 0);
            };

            if (!img && selectedText) {
                // Text-only context menu
                document.querySelectorAll('.text-ctx-menu').forEach(m => m.remove());
                const menu = document.createElement('div');
                menu.className = 'text-ctx-menu';
                menu.style.cssText = menuBase;
                const mkItem = mkCtxItem(menu);
                const truncated = selectedText.length > 30 ? selectedText.substring(0, 30) + '…' : selectedText;
                menu.appendChild(mkItem(`创建 Todo「${truncated}」`, async () => {
                    await createTodoFromText(selectedText, editingTodo);
                }));
                attachClose(menu);
                return;
            }

            // --- Image right-click menu ---
            document.querySelectorAll('.img-ctx-menu').forEach(m => m.remove());
            const currentWidth = Math.round(img.getBoundingClientRect().width);
            const menu = document.createElement('div');
            menu.className = 'img-ctx-menu';
            menu.style.cssText = menuBase;
            const mkItem = mkCtxItem(menu);
            menu.appendChild(mkItem(`设为默认宽度 (${currentWidth}px)`, async () => {
                imgDefaultWidth = currentWidth;
                await window.electronAPI.setSetting('imgDefaultWidth', currentWidth);
                showToast(`默认宽度已设为 ${currentWidth}px`);
            }));
            menu.appendChild(mkItem(`把所有图片调成 ${currentWidth}px`, () => {
                const all = document.getElementById('editor-content').querySelectorAll('img');
                all.forEach(im => {
                    im.style.width = currentWidth + 'px';
                    im.style.maxWidth = currentWidth + 'px';
                    im.style.height = 'auto';
                });
                schedSave();
                showToast(`${all.length} 张图片已统一为 ${currentWidth}px`);
            }));
            menu.appendChild(mkItem('查看大图', () => showImageLightbox(img.src)));
            menu.appendChild(mkItem('复制图片', async () => {
                try {
                    let filePath = '';
                    try {
                        const u = new URL(img.src);
                        const filename = decodeURIComponent(u.pathname.split('/').pop());
                        filePath = filename;
                    } catch (err) {}
                    const r = await window.electronAPI.copyImage(filePath, img.src);
                    if (r && r.success) showToast('已复制');
                    else throw new Error(r && r.error || 'copy failed');
                } catch (err) { showToast('复制失败: ' + err.message); }
            }));
            if (selectedText) {
                const truncated = selectedText.length > 30 ? selectedText.substring(0, 30) + '…' : selectedText;
                menu.appendChild(mkItem(`创建 Todo「${truncated}」`, async () => {
                    await createTodoFromText(selectedText, editingTodo);
                }));
            }
            menu.appendChild(mkItem('删除', () => { img.remove(); schedSave(); }, true));
            attachClose(menu);
        });

        // --- Image resize ---
        (() => {
            const handle = document.getElementById('img-resize-handle');
            let resizeImg = null;
            let startX, startWidth;

            function positionHandle(img) {
                const rect = img.getBoundingClientRect();
                const editorRect = document.getElementById('editor-content').parentElement.getBoundingClientRect();
                handle.style.left = (rect.right - editorRect.left - 6) + 'px';
                handle.style.top = (rect.bottom - editorRect.top - 6) + 'px';
                handle.style.display = 'block';
            }

            function selectImage(img) {
                if (resizeImg) resizeImg.classList.remove('img-selected');
                resizeImg = img;
                img.classList.add('img-selected');
                positionHandle(img);
            }

            function deselectImage() {
                if (resizeImg) resizeImg.classList.remove('img-selected');
                resizeImg = null;
                handle.style.display = 'none';
            }

            document.getElementById('editor-content').addEventListener('click', (e) => {
                const img = e.target.closest('img');
                if (img && !e.metaKey && !e.ctrlKey && e.detail === 1) {
                    e.preventDefault();
                    selectImage(img);
                } else if (!img && !e.target.closest('.img-resize-handle')) {
                    deselectImage();
                }
            });

            handle.addEventListener('mousedown', (e) => {
                if (!resizeImg) return;
                e.preventDefault();
                startX = e.clientX;
                startWidth = resizeImg.offsetWidth;
                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', onResizeEnd);
            });

            function onResize(e) {
                if (!resizeImg) return;
                const newWidth = Math.max(40, startWidth + (e.clientX - startX));
                resizeImg.style.width = newWidth + 'px';
                resizeImg.style.maxWidth = newWidth + 'px';
                resizeImg.style.height = 'auto';
                positionHandle(resizeImg);
            }

            function onResizeEnd() {
                document.removeEventListener('mousemove', onResize);
                document.removeEventListener('mouseup', onResizeEnd);
                schedSave();
            }

            const observer = new MutationObserver(() => { if (resizeImg && !document.getElementById('editor-content').contains(resizeImg)) deselectImage(); });
            observer.observe(document.getElementById('editor-content'), { childList: true, subtree: true });

            document.getElementById('editor-content').addEventListener('scroll', () => { if (resizeImg) positionHandle(resizeImg); });
        })();

        // --- Image default width (set by right-clicking an image → "Set as default size") ---
        let imgDefaultWidth = 120;
        (async () => {
            const w = await window.electronAPI.getSetting('imgDefaultWidth');
            if (typeof w === 'number' && w > 0) imgDefaultWidth = w;
        })();
        function imgInsertStyle() {
            return `max-width:${imgDefaultWidth}px;border-radius:6px;cursor:pointer;vertical-align:middle;`;
        }

        // --- Image compression ---
        let compressionEnabled = false;
        (async () => {
            compressionEnabled = (await window.electronAPI.getSetting('img-compression')) === true;
            updateCompressBtn();
        })();
        function updateCompressBtn() {
            const btn = document.getElementById('tb-compress');
            btn.style.opacity = compressionEnabled ? '1' : '0.4';
            btn.title = compressionEnabled ? 'Compression ON' : 'Compression OFF';
        }
        document.getElementById('tb-compress').addEventListener('click', async () => {
            compressionEnabled = !compressionEnabled;
            await window.electronAPI.setSetting('img-compression', compressionEnabled);
            updateCompressBtn();
        });

        async function compressImage(file, quality = 0.7, maxWidth = 1200) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width, height = img.height;
                        if (width > maxWidth) { height = (maxWidth / width) * height; width = maxWidth; }
                        canvas.width = width; canvas.height = height;
                        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                        canvas.toBlob((blob) => {
                            if (!blob) return reject(new Error('toBlob failed'));
                            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
                        }, 'image/jpeg', quality);
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        }

        async function prepareImage(file) {
            if (compressionEnabled && file.type.startsWith('image/')) {
                try { return await compressImage(file); } catch (e) {}
            }
            return file;
        }

        // Image upload
        document.getElementById('img-upload').addEventListener('change', async (e) => {
            for (let file of e.target.files) {
                file = await prepareImage(file);
                const fd = new FormData();
                fd.append('image', file);
                const res = await fetch(`${baseURL}/api/upload`, {
                    method: 'POST',
                    headers: { 'X-Project': currentProject, ...(authHeader ? { 'Authorization': authHeader } : {}) },
                    body: fd
                });
                const data = await res.json();
                if (data.url) {
                    document.getElementById('editor-content').focus();
                    document.execCommand('insertHTML', false,
                        `<img src="${baseURL}${data.url}" style="${imgInsertStyle()}">`);
                    await flushSave();
                }
            }
            e.target.value = '';
            window.electronAPI.unlockBlur();
        });
        // Also unlock if user cancels the file picker (no change event fires, but focus returns)
        document.getElementById('img-upload').addEventListener('click', () => {
            const unlock = () => {
                setTimeout(() => window.electronAPI.unlockBlur(), 300);
                window.removeEventListener('focus', unlock);
            };
            window.addEventListener('focus', unlock);
        });

        // --- Export button ---
        document.getElementById('tb-export').addEventListener('click', (e) => {
            e.stopPropagation();
            let menu = document.querySelector('.export-menu');
            if (menu) { menu.remove(); return; }
            menu = document.createElement('div');
            menu.className = 'export-menu show';
            menu.innerHTML = `
                <div class="export-menu-item" data-action="copy-rich">Copy Rich Text</div>
                <div class="export-menu-item" data-action="copy-plain">Copy Plain Text</div>
                <div class="export-menu-item" data-action="export-md">Export Markdown</div>
                <div class="export-menu-item" data-action="export-html">Export HTML</div>
                <div class="export-menu-item" data-action="export-pdf">Export PDF</div>
                <div class="export-menu-item" data-action="export-image">Export Long Image</div>
            `;
            const toolbar = document.querySelector('.editor-toolbar');
            toolbar.style.position = 'relative';
            toolbar.appendChild(menu);

            menu.addEventListener('click', async (ev) => {
                const action = ev.target.dataset.action;
                if (!action) return;
                menu.remove();
                toolbar.style.position = '';
                const editorEl = document.getElementById('editor-content');
                const title = document.getElementById('editor-title').value || 'Untitled';

                function getPlainText() {
                    const origBlocks = editorEl.querySelectorAll('.code-block');
                    const clone = editorEl.cloneNode(true);
                    const cloneBlocks = clone.querySelectorAll('.code-block');
                    cloneBlocks.forEach((block, i) => {
                        let code = '';
                        if (origBlocks[i] && origBlocks[i]._cmView) {
                            code = origBlocks[i]._cmView.state.doc.toString();
                        }
                        const pre = document.createElement('pre');
                        pre.textContent = code;
                        block.replaceWith(pre);
                    });
                    clone.style.position = 'fixed';
                    clone.style.left = '-9999px';
                    clone.style.whiteSpace = 'pre-wrap';
                    document.body.appendChild(clone);
                    const text = clone.innerText;
                    clone.remove();
                    return text.replace(ZW_RE, '');
                }

                if (action === 'copy-rich') {
                    const html = editorEl.innerHTML.replace(ZW_RE, '');
                    const blob = new Blob([html], { type: 'text/html' });
                    const plainBlob = new Blob([getPlainText()], { type: 'text/plain' });
                    await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': plainBlob })]);
                    showToast('Rich text copied');
                } else if (action === 'copy-plain') {
                    await navigator.clipboard.writeText(getPlainText());
                    showToast('Plain text copied');
                } else if (action === 'export-md') {
                    const tmpDiv = document.createElement('div');
                    tmpDiv.innerHTML = editorEl.innerHTML;
                    const imgs = tmpDiv.querySelectorAll('img');
                    const imageFiles = [];
                    let imgIdx = 0;
                    for (const img of imgs) {
                        try {
                            const resp = await fetch(img.src);
                            const buf = await resp.arrayBuffer();
                            const type = resp.headers.get('content-type') || 'image/png';
                            const ext = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg';
                            const filename = `image_${++imgIdx}.${ext}`;
                            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                            imageFiles.push({ filename, base64: b64 });
                            img.src = `images/${filename}`;
                        } catch (e) {}
                    }
                    const md = htmlToMarkdown(title, tmpDiv.innerHTML);
                    const result = await window.electronAPI.exportMarkdown(md, imageFiles, title);
                    if (result?.success) showToast('Markdown exported');
                } else if (action === 'export-html') {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = editorEl.innerHTML;
                    const imgs = tmp.querySelectorAll('img');
                    for (const img of imgs) {
                        try {
                            const resp = await fetch(img.src);
                            const buf = await resp.arrayBuffer();
                            const type = resp.headers.get('content-type') || 'image/png';
                            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                            img.src = `data:${type};base64,${b64}`;
                        } catch (e) {}
                        img.style.cursor = 'pointer';
                        img.setAttribute('onclick', '(function(s){var w=window.open("","_blank");w.document.write(\'<!DOCTYPE html><html><head><title>Image</title><style>*{margin:0;padding:0;}body{background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style></head><body><img src="\'+s+\'"></body></html>\');w.document.close();})(this.src)');
                    }
                    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:-apple-system,sans-serif;padding:24px;font-size:14px;line-height:1.6;max-width:800px;margin:0 auto;}h1{font-size:20px;margin-bottom:12px;}img{max-width:100%;border-radius:6px;cursor:pointer;}a{color:#0066cc;}</style></head><body><h1>${esc(title)}</h1>${tmp.innerHTML}</body></html>`;
                    const blob = new Blob([htmlContent], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `${title}.html`; a.click();
                    URL.revokeObjectURL(url);
                    showToast('HTML exported');
                } else if (action === 'export-pdf') {
                    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:-apple-system,sans-serif;padding:24px;font-size:14px;line-height:1.6;}h1{font-size:20px;margin-bottom:12px;}img{max-width:100%;}</style></head><body><h1>${esc(title)}</h1>${editorEl.innerHTML}</body></html>`;
                    const result = await window.electronAPI.exportPDF(htmlContent, title);
                    if (result?.success) showToast('PDF exported');
                    else if (result?.error) showToast(result.error);
                } else if (action === 'export-image') {
                    // Embed images as base64 so the offscreen renderer can load them without auth
                    const tmp = document.createElement('div');
                    tmp.innerHTML = editorEl.innerHTML;
                    for (const img of tmp.querySelectorAll('img')) {
                        try {
                            const resp = await fetch(img.src);
                            const buf = await resp.arrayBuffer();
                            const type = resp.headers.get('content-type') || 'image/png';
                            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                            img.src = `data:${type};base64,${b64}`;
                        } catch (e) {}
                    }
                    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>html,body{margin:0;padding:0;background:#fff;}body{font-family:-apple-system,'PingFang SC',sans-serif;padding:24px;font-size:14px;line-height:1.6;color:#222;width:800px;box-sizing:border-box;}h1{font-size:20px;margin:0 0 12px;}img{max-width:100%;border-radius:6px;display:block;margin:8px 0;}a{color:#0066cc;}pre,.code-block{background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:10px;overflow:auto;font-family:Menlo,Monaco,monospace;font-size:12px;}.cb{display:inline-block;}</style></head><body><h1>${esc(title)}</h1>${tmp.innerHTML}</body></html>`;
                    showToast('Rendering long image...');
                    const result = await window.electronAPI.exportImage(htmlContent, title);
                    if (result?.success) showToast('Long image exported');
                    else if (result?.error) showToast(result.error);
                }
            });

            const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); toolbar.style.position = ''; document.removeEventListener('click', closeMenu); } };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });

        // --- Zoom editor ---
        let isZoomed = false;

        document.getElementById('tb-zoom').addEventListener('click', () => {
            isZoomed = !isZoomed;
            document.body.classList.toggle('zoomed', isZoomed);
            document.getElementById('tb-zoom').textContent = isZoomed ? '❐' : '⛶';
            document.getElementById('tb-zoom').title = isZoomed ? 'Restore editor (Ctrl+Shift+Z)' : 'Zoom editor (Ctrl+Shift+Z)';
            if (isZoomed) {
                document.getElementById('zoom-title').textContent = document.getElementById('editor-title').value || '';
            }
        });

        function htmlToMarkdown(title, html) {
            let md = `# ${title}\n\n`;
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            function walk(node) {
                let result = '';
                for (const child of node.childNodes) {
                    if (child.nodeType === 3) { result += child.textContent; continue; }
                    if (child.nodeType !== 1) continue;
                    const tag = child.tagName.toLowerCase();
                    if (tag === 'br') { result += '\n'; continue; }
                    if (tag === 'div' || tag === 'p') { result += '\n' + walk(child); continue; }
                    if (tag === 'b' || tag === 'strong') { result += `**${walk(child)}**`; continue; }
                    if (tag === 'i' || tag === 'em') { result += `*${walk(child)}*`; continue; }
                    if (tag === 'a') { result += `[${walk(child)}](${child.getAttribute('href') || ''})`; continue; }
                    if (tag === 'img') { result += `![image](${child.getAttribute('src') || ''})`; continue; }
                    result += walk(child);
                }
                return result;
            }
            md += walk(tmp).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
            return md;
        }

        // Paste link/path auto-detect
        document.getElementById('editor-content').addEventListener('paste', (e) => {
            const text = e.clipboardData?.getData('text/plain');
            if (!text) return;
            const trimmed = text.trim();
            // URL
            if (/^https?:\/\/\S+$/i.test(trimmed)) {
                e.preventDefault();
                document.execCommand('insertHTML', false, `<a href="${trimmed}">${trimmed}</a>`);
                schedSave();
                return;
            }
            // File path: macOS (/...) or Windows (C:\... or \\...)
            if (/^(\/[^\s]+|[A-Z]:\\[^\s]+|\\\\[^\s]+)$/i.test(trimmed)) {
                e.preventDefault();
                const escaped = trimmed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                document.execCommand('insertHTML', false, `<a href="file://${escaped}" class="file-link">${escaped}</a>`);
                schedSave();
                return;
            }
        });

        // Paste image support
        document.getElementById('editor-content').addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    let file = item.getAsFile();
                    file = await prepareImage(file);
                    const fd = new FormData();
                    fd.append('image', file);
                    const res = await fetch(`${baseURL}/api/upload`, {
                        method: 'POST',
                        headers: { 'X-Project': currentProject, ...(authHeader ? { 'Authorization': authHeader } : {}) },
                        body: fd
                    });
                    const data = await res.json();
                    if (data.url) {
                        document.execCommand('insertHTML', false,
                            `<img src="${baseURL}${data.url}" style="${imgInsertStyle()}">`);
                        // Force immediate save (not debounced) so image is persisted before user can ESC
                        await flushSave();
                    }
                    break;
                }
            }
        });

        // --- New task ---
        document.getElementById('new-input').addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && e.target.value.trim()) {
                const date = (selectedDate === 'overdue' || selectedDate === 'future') ? todayStr : selectedDate;
                const newTodo = {
                    id: crypto.randomUUID(),
                    title: e.target.value.trim(),
                    content: '',
                    completed: false,
                    date: date,
                    order: todos.length,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                await saveTodo(newTodo);
                e.target.value = '';
                await loadTodos();
                // Simulate user click to open the new todo
                const created = todos.find(t => t.id === newTodo.id);
                if (created) openEditor(created);
            }
        });

        // --- Menu ---
        const menuBtn = document.getElementById('menu-btn');
        const dropdownMenu = document.getElementById('dropdown-menu');
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
        document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
        dropdownMenu.addEventListener('click', (e) => e.stopPropagation());

        function showToast(msg) {
            let t = document.getElementById('toast-msg');
            if (!t) {
                t = document.createElement('div');
                t.id = 'toast-msg';
                t.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--toast-bg);color:#fff;padding:6px 16px;border-radius:6px;font-size:12px;z-index:9999;opacity:0;transition:opacity 0.2s;pointer-events:none;';
                document.body.appendChild(t);
            }
            t.textContent = msg;
            t.style.opacity = '1';
            clearTimeout(t._timer);
            t._timer = setTimeout(() => t.style.opacity = '0', 2000);
        }

        function buildWeeklyMarkdown(data) {
            let md = '';
            const projectNames = Object.keys(data).sort();
            projectNames.forEach(pn => {
                md += `# PROJECT: ${pn}\n\n`;
                const pd = data[pn];
                Object.keys(pd).sort().forEach(date => {
                    const todos = pd[date].todos;
                    if (todos.length > 0) {
                        const d = new Date(date + 'T00:00:00');
                        const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
                        md += `## ${date} (${day})\n\n`;
                        todos.forEach(t => {
                            md += `${t.completed ? '[x]' : '[ ]'} **${t.title || '(No Title)'}**\n`;
                            if (t.content) {
                                const clean = t.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '').trim();
                                if (clean) md += clean.split('\n').filter(l => l.trim()).map(l => `   > ${l.trim()}`).join('\n') + '\n';
                            }
                        });
                        md += '\n';
                    }
                });
                md += '---\n\n';
            });
            return md.trim();
        }

        document.getElementById('menu-open-folder').addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            window.electronAPI.openProjectFolder(currentProject);
            window.electronAPI.hidePanel();
        });
        document.getElementById('menu-open-url').addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            if (!isLocalBase()) {
                window.electronAPI.openExternal(baseURL);
            } else {
                window.electronAPI.openExternal(baseURL);
            }
        });

        document.getElementById('menu-export-week').addEventListener('click', async () => {
            dropdownMenu.classList.remove('show');
            try {
                const res = await fetch(`${baseURL}/api/export-all?date=${selectedDate}`, { headers: headers() });
                const data = await res.json();
                const md = buildWeeklyMarkdown(data);
                window.electronAPI.lockBlur();
                window.electronAPI.openReportWindow(md, selectedDate);
            } catch (e) { showToast('Export failed'); }
        });


        document.getElementById('menu-help').addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            window.electronAPI.openHelp();
        });
        document.getElementById('menu-settings').addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
            openSettings();
        });

        // --- Settings overlay (⌘,) ---
        async function openSettings() {
            window.electronAPI.lockBlur();
            const shortcut = await window.electronAPI.getShortcut();
            let projects = [];
            try {
                const projRes = await fetch(`${baseURL}/api/projects`, { headers: headers() });
                const projData = await projRes.json();
                projects = projData.projects || [];
            } catch (e) {}
            const customThemes = await window.electronAPI.listCustomThemes();
            const activeCustomFile = (await window.electronAPI.getSetting('customThemeFile')) || 'default';
            const savedRemoteURL = (await window.electronAPI.getSetting('remoteURL')) || '';
            const savedUseRemote = await window.electronAPI.getSetting('useRemote');
            const savedRemoteUser = (await window.electronAPI.getSetting('remoteUser')) || '';
            const savedRemotePass = (await window.electronAPI.getSetting('remotePass')) || '';

            const overlay = document.createElement('div');
            overlay.id = 'settings-overlay';
            overlay.className = 'set-overlay';
            const currentTheme = (await window.electronAPI.getSetting('theme')) || 'dusk';
            overlay.innerHTML = `
            <div class="set-panel">
                <div class="set-sidebar">
                    <div style="font-size:13px;font-weight:600;color:var(--text-bright);padding:4px 10px 8px;">Settings</div>
                    <div class="set-sidebar-item active" data-target="theme">🎨 Theme</div>
                    <div class="set-sidebar-item" data-target="server">☁️ Server</div>
                    <div class="set-sidebar-item" data-target="toolbar">🛠 Toolbar</div>
                    <div class="set-sidebar-item" data-target="shortcut">⌨️ Shortcut</div>
                    <div class="set-sidebar-item" data-target="system">⚙️ System</div>
                    <div class="set-sidebar-item" data-target="projects">📂 Projects</div>
                </div>
                <div class="set-main">
                <div class="set-header" style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                    <button id="set-close" class="set-close">✕</button>
                </div>

                <div class="set-section set-section-active" data-section="theme">
                    <div class="set-label">Theme</div>
                    <div class="set-theme-grid">
                        ${[
                            ['dusk','Dusk'],['ocean','Ocean'],['forest','Forest'],['midnight','Midnight'],
                            ['aurora','Aurora'],['blossom','Blossom'],['dark','Dark'],['light','Light'],
                            ['paper','Paper'],['cute','Animal'],['cyberpunk','Cyber'],['wood','Wood'],
                            ['monokai','Monokai'],['onedark','OneDark'],['hc-black','HC Dark'],['hc-white','HC Light'],
                            ['hub','Hub'],['glass-dark','Glass Dark'],['glass-light','Glass Light'],['custom','Custom']
                        ].filter(([k])=> !k.startsWith('glass') || navigator.platform.includes('Mac')).map(([k,v])=>`<button class="set-theme-btn ${currentTheme===k?'active':''}" data-theme="${k}">${v}</button>`).join('')}
                    </div>
                    <div class="set-row" style="margin-top:6px;">
                        <select id="custom-theme-select" style="flex:1;padding:3px 6px;background:var(--bg-input);border:1px solid var(--border-input);border-radius:5px;color:var(--text);font-size:11px;outline:none;">
                            ${customThemes.map(f=>`<option value="${f}" ${f===activeCustomFile?'selected':''}>${f}</option>`).join('')}
                        </select>
                        <button class="set-btn" id="btn-refresh-themes" title="Refresh">↻</button>
                        <button class="set-btn" id="btn-apply-theme" title="Apply">Apply</button>
                        <button class="set-btn" id="btn-open-themes-folder" title="Open Folder">📂</button>
                    </div>
                </div>

                <div class="set-section" data-section="server">
                    <div class="set-label">Server</div>
                    <div class="set-row">
                        <select id="set-server-mode" style="flex:1;padding:3px 6px;background:var(--bg-input);border:1px solid var(--border-input);border-radius:5px;color:var(--text);font-size:12px;outline:none;">
                            <option value="local" ${!savedUseRemote?'selected':''}>Local</option>
                            <option value="remote" ${savedUseRemote&&!savedRemoteUser?'selected':''}>Remote</option>
                            <option value="remote-auth" ${savedUseRemote&&savedRemoteUser?'selected':''}>Remote + Auth</option>
                        </select>
                        <button class="set-btn" id="btn-quick-local" style="font-weight:700;${!savedUseRemote?'background:var(--accent-bg);border-color:var(--accent);':''}">L</button>
                        <button class="set-btn" id="btn-quick-remote" style="font-weight:700;${savedUseRemote?'background:var(--accent-bg);border-color:var(--accent);':''}">R</button>
                    </div>
                    <div id="remote-url-row" style="margin-top:6px;display:${savedUseRemote?'flex':'none'};gap:4px;">
                        <input id="set-remote-url" class="set-input" placeholder="https://your-server.com" value="${savedRemoteURL}" style="flex:1;">
                        <button class="set-btn" id="btn-connect-remote">Connect</button>
                    </div>
                    <div id="remote-auth-row" style="margin-top:5px;display:${savedUseRemote&&savedRemoteUser?'flex':'none'};gap:4px;">
                        <input id="set-remote-user" class="set-input" placeholder="user" value="${savedRemoteUser}" style="flex:1;">
                        <input id="set-remote-pass" class="set-input" type="password" placeholder="password" value="${savedRemotePass}" style="flex:1;">
                    </div>
                </div>

                <div class="set-section" data-section="toolbar">
                    <div class="set-label">Toolbar Customization</div>

                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Emoji List (⌘E)</div>
                    <textarea id="set-emoji-list" class="set-input" style="width:100%;font-size:18px;line-height:1.4;resize:none;overflow:hidden;" placeholder="Paste emojis here — they will appear in the picker"></textarea>
                    <div class="set-row" style="margin-top:5px;">
                        <button class="set-btn" id="btn-emoji-reset">Reset to defaults</button>
                        <button class="set-btn" id="btn-emoji-save">Save</button>
                    </div>

                    <div style="font-size:11px;color:var(--text-muted);margin:14px 0 4px;">Date/Time Format (🕐)</div>
                    <div class="set-row">
                        <input id="set-dt-format" class="set-input" style="flex:1;" placeholder="YYYY-MM-DD HH:mm:ss">
                        <button class="set-btn" id="btn-dt-save">Save</button>
                    </div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Tokens: YYYY MM DD HH mm ss</div>

                    <div style="font-size:11px;color:var(--text-muted);margin:14px 0 4px;">Custom JS (🔧 advanced)</div>
                    <div class="set-row">
                        <label style="flex:1;font-size:12px;color:var(--text);display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="set-custom-js-enabled"> Enable toolbar button
                        </label>
                        <button class="set-btn" id="btn-open-custom-js-folder">📂 Open folder</button>
                    </div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Put .js files in the folder. Click toolbar button to pick one to run.</div>
                </div>

                <div class="set-section" data-section="shortcut">
                    <div class="set-label">Global Shortcut</div>
                    <div class="set-row">
                        <span id="set-shortcut-display" class="set-shortcut-val">${shortcut}</span>
                        <button id="set-shortcut-change" class="set-btn">Record</button>
                    </div>
                    <div class="set-label" style="margin-top:14px;">Zoom Editor Shortcut</div>
                    <div class="set-row">
                        <span id="set-zoom-shortcut-display" class="set-shortcut-val">${localStorage.getItem('zoom-shortcut') || 'CommandOrControl+L'}</span>
                        <button id="set-zoom-shortcut-change" class="set-btn">Record</button>
                    </div>
                </div>

                <div class="set-section" data-section="system">
                    <div class="set-label">System</div>
                    <div class="set-row">
                        <label style="flex:1;font-size:12px;color:var(--text);display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="set-auto-launch"> 开机自启动
                        </label>
                    </div>
                    <div class="set-row" style="margin-top:6px;">
                        <span style="flex:1;font-size:12px;color:var(--text);">闲置自动隐藏（分钟，0 关闭）</span>
                        <input id="set-idle-min" type="number" min="0" step="1" class="set-input" style="width:70px;">
                        <button class="set-btn" id="btn-idle-save">Save</button>
                    </div>
                    <div class="set-row" style="margin-top:6px;">
                        <span style="flex:1;font-size:12px;color:var(--text);">界面大小 (⌘+ / ⌘- / ⌘0)</span>
                        <button class="set-btn" id="btn-zoom-out" style="width:28px;">−</button>
                        <span id="set-zoom-display" style="min-width:48px;text-align:center;font-size:11px;color:var(--text-muted);">100%</span>
                        <button class="set-btn" id="btn-zoom-in" style="width:28px;">+</button>
                        <button class="set-btn" id="btn-zoom-reset">Reset</button>
                    </div>
                    <div class="set-row" style="margin-top:6px;">
                        <span id="set-update-status" style="flex:1;font-size:11px;color:var(--text-muted);">Current: …  |  Latest: …</span>
                        <button class="set-btn" id="btn-check-update">Check</button>
                        <button class="set-btn" id="btn-release-notes">Release Notes</button>
                    </div>
                </div>

                <div class="set-section" data-section="projects">
                    <div class="set-proj-header">
                        <div class="set-label" style="margin-bottom:0;">Projects</div>
                        <div class="set-row">
                            <button id="set-import-proj" class="set-btn">Import</button>
                            <button id="set-new-proj" class="set-btn-primary">+ New</button>
                        </div>
                    </div>
                    <div id="set-proj-list" class="set-proj-list">
                        ${projects.map(p => `
                        <div class="set-proj-row" data-name="${p}">
                            <span class="set-proj-name ${p === currentProject ? 'current' : ''}">${p}</span>
                            ${p === currentProject ? '<span class="set-dot"></span>' : ''}
                            <div class="set-proj-actions">
                                <button class="set-proj-action set-proj-export" data-name="${p}">Export</button>
                                ${p !== 'Default' ? `
                                <button class="set-proj-action set-proj-rename" data-name="${p}">Rename</button>
                                <button class="set-proj-action danger set-proj-delete" data-name="${p}">Delete</button>
                                ` : ''}
                            </div>
                        </div>`).join('')}
                    </div>
                </div>
                </div>
            </div>`;
            document.body.appendChild(overlay);

            const closeSettings = () => { overlay.remove(); window.electronAPI.unlockBlur(); };
            document.getElementById('set-close').onclick = closeSettings;

            // Sidebar tab switching
            overlay.querySelectorAll('.set-sidebar-item').forEach(item => {
                item.addEventListener('click', () => {
                    const target = item.dataset.target;
                    overlay.querySelectorAll('.set-sidebar-item').forEach(i => i.classList.toggle('active', i === item));
                    overlay.querySelectorAll('.set-section[data-section]').forEach(s => s.classList.toggle('set-section-active', s.dataset.section === target));
                    // Re-fire emoji autoGrow if switching to toolbar (textarea sized 0 when display:none)
                    if (target === 'toolbar') {
                        const ta = document.getElementById('set-emoji-list');
                        if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
                    }
                });
            });

            // Emoji list
            const emojiTextarea = document.getElementById('set-emoji-list');
            function autoGrow() {
                emojiTextarea.style.height = 'auto';
                emojiTextarea.style.height = emojiTextarea.scrollHeight + 'px';
            }
            emojiTextarea.addEventListener('input', autoGrow);
            (async () => {
                const list = await getEmojiList();
                emojiTextarea.value = list.join('');
                requestAnimationFrame(autoGrow);
            })();
            document.getElementById('btn-emoji-reset').onclick = async () => {
                emojiTextarea.value = DEFAULT_EMOJIS.join('');
                autoGrow();
                await window.electronAPI.setSetting('emojiList', DEFAULT_EMOJIS);
                showToast('Emoji list reset');
            };
            // Custom JS
            (async () => {
                const en = await window.electronAPI.getSetting('customJsEnabled');
                document.getElementById('set-custom-js-enabled').checked = !!en;
            })();
            document.getElementById('set-custom-js-enabled').addEventListener('change', async (e) => {
                await window.electronAPI.setSetting('customJsEnabled', e.target.checked);
                const btn = document.getElementById('tb-custom');
                if (btn) btn.style.display = e.target.checked ? '' : 'none';
            });
            document.getElementById('btn-open-custom-js-folder').onclick = () => {
                window.electronAPI.openCustomJsFolder();
            };

            // Datetime format
            (async () => {
                const fmt = (await window.electronAPI.getSetting('dateTimeFormat')) || DEFAULT_DT_FORMAT;
                document.getElementById('set-dt-format').value = fmt;
            })();
            document.getElementById('btn-dt-save').onclick = async () => {
                const fmt = document.getElementById('set-dt-format').value.trim() || DEFAULT_DT_FORMAT;
                await window.electronAPI.setSetting('dateTimeFormat', fmt);
                showToast('Format saved: ' + formatDateTime(fmt));
            };

            // System: auto-launch + update check
            (async () => {
                const al = await window.electronAPI.getAutoLaunch();
                document.getElementById('set-auto-launch').checked = !!al;
            })();
            // Idle auto-hide control
            const idleInput = document.getElementById('set-idle-min');
            if (idleInput) {
                idleInput.value = idleTimeoutMin;
                document.getElementById('btn-idle-save').onclick = async () => {
                    const v = parseInt(idleInput.value, 10);
                    const clamped = isNaN(v) || v < 0 ? 0 : v;
                    idleTimeoutMin = clamped;
                    await window.electronAPI.setSetting('idleHideMinutes', clamped);
                    armIdleTimer();
                    showToast(clamped === 0 ? '闲置自动隐藏已关闭' : `闲置 ${clamped} 分钟后隐藏`);
                };
            }

            // Zoom controls
            const zd = document.getElementById('set-zoom-display');
            if (zd) zd.textContent = Math.round(uiZoom * 100) + '%';
            document.getElementById('btn-zoom-in').onclick = () => setZoom(uiZoom + 0.1);
            document.getElementById('btn-zoom-out').onclick = () => setZoom(uiZoom - 0.1);
            document.getElementById('btn-zoom-reset').onclick = () => setZoom(1);

            document.getElementById('set-auto-launch').addEventListener('change', async (e) => {
                const r = await window.electronAPI.setAutoLaunch(e.target.checked);
                if (r && r.success) showToast(e.target.checked ? '开机自启动已开启' : '开机自启动已关闭');
                else showToast('设置失败: ' + (r && r.error || ''));
            });
            // Show current version immediately, auto-fetch latest
            const renderUpdateStatus = (current, latest, url) => {
                const status = document.getElementById('set-update-status');
                if (!status) return;
                const cmpParts = (a, b) => {
                    const pa = (a || '').split(/[.\-]/).map(s => parseInt(s, 10) || 0);
                    const pb = (b || '').split(/[.\-]/).map(s => parseInt(s, 10) || 0);
                    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                        if ((pa[i]||0) !== (pb[i]||0)) return (pa[i]||0) - (pb[i]||0);
                    }
                    return 0;
                };
                const has = latest && cmpParts(latest, current) > 0;
                if (latest) {
                    status.innerHTML = `Current: <b>v${current}</b>  |  Latest: <b style="${has ? 'color:var(--accent);' : ''}">v${latest}</b>` + (has && url ? ` — <a href="#" id="open-release">Download</a>` : '');
                    if (has && url) {
                        const link = document.getElementById('open-release');
                        if (link) link.onclick = (ev) => { ev.preventDefault(); window.electronAPI.openExternal(url); };
                    }
                } else {
                    status.innerHTML = `Current: <b>v${current}</b>  |  Latest: <span style="color:var(--text-muted);">checking…</span>`;
                }
            };
            (async () => {
                const current = await window.electronAPI.getAppVersion();
                renderUpdateStatus(current, '', '');
                const r = await window.electronAPI.checkUpdate();
                if (!r || r.error) {
                    const status = document.getElementById('set-update-status');
                    if (status) status.innerHTML = `Current: <b>v${current}</b>  |  Latest: <span style="color:var(--danger);">check failed</span>`;
                    return;
                }
                renderUpdateStatus(r.current || current, r.latest, r.url);
            })();
            document.getElementById('btn-check-update').onclick = async () => {
                const status = document.getElementById('set-update-status');
                const current = await window.electronAPI.getAppVersion();
                status.innerHTML = `Current: <b>v${current}</b>  |  Latest: <span style="color:var(--text-muted);">checking…</span>`;
                const r = await window.electronAPI.checkUpdate();
                if (!r || r.error) { status.innerHTML = `Current: <b>v${current}</b>  |  Latest: <span style="color:var(--danger);">${(r && r.error) || 'failed'}</span>`; return; }
                renderUpdateStatus(r.current || current, r.latest, r.url);
            };
            document.getElementById('btn-release-notes').onclick = async () => {
                const md = await window.electronAPI.getReleaseNotes();
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:20000;display:flex;align-items:center;justify-content:center;padding:40px;';
                const box = document.createElement('div');
                box.style.cssText = 'background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:8px;width:100%;max-width:720px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
                const header = document.createElement('div');
                header.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;';
                header.innerHTML = '<span style="flex:1;font-size:13px;color:var(--text-bright);font-weight:600;">Release Notes</span>';
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = 'padding:3px 8px;background:none;color:var(--text);border:none;cursor:pointer;font-size:14px;';
                closeBtn.onclick = () => overlay.remove();
                header.appendChild(closeBtn);
                const body = document.createElement('div');
                body.style.cssText = 'flex:1;overflow:auto;padding:14px 18px;color:var(--text);font-size:13px;line-height:1.65;';
                // Minimal markdown → HTML rendering
                const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                let html = '';
                const lines = (md || '_(empty)_').split('\n');
                let inList = false;
                for (const raw of lines) {
                    const l = raw.trimEnd();
                    if (l.startsWith('### ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h3 style="margin:14px 0 6px;font-size:13px;color:var(--accent);">${escapeHtml(l.slice(4))}</h3>`; }
                    else if (l.startsWith('## ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h2 style="margin:18px 0 8px;font-size:15px;color:var(--text-bright);border-bottom:1px solid var(--border);padding-bottom:4px;">${escapeHtml(l.slice(3))}</h2>`; }
                    else if (l.startsWith('# ')) { if (inList) { html += '</ul>'; inList = false; } html += `<h1 style="margin:0 0 12px;font-size:18px;color:var(--text-bright);">${escapeHtml(l.slice(2))}</h1>`; }
                    else if (l.startsWith('---')) { if (inList) { html += '</ul>'; inList = false; } html += '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">'; }
                    else if (l.startsWith('- ')) {
                        if (!inList) { html += '<ul style="padding-left:20px;margin:4px 0;">'; inList = true; }
                        let item = escapeHtml(l.slice(2));
                        item = item.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>');
                        html += `<li style="margin:3px 0;">${item}</li>`;
                    }
                    else if (l.trim() === '') { if (inList) { html += '</ul>'; inList = false; } }
                    else {
                        if (inList) { html += '</ul>'; inList = false; }
                        let p = escapeHtml(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>');
                        html += `<p style="margin:6px 0;">${p}</p>`;
                    }
                }
                if (inList) html += '</ul>';
                body.innerHTML = html;
                box.appendChild(header);
                box.appendChild(body);
                overlay.appendChild(box);
                overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
                document.body.appendChild(overlay);
            };

            document.getElementById('btn-emoji-save').onclick = async () => {
                const raw = document.getElementById('set-emoji-list').value;
                const list = [...raw].filter(c => c.trim() && c !== '\n');
                // Group surrogate pairs and ZWJ sequences using grapheme-like split
                const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
                let parsed;
                if (segmenter) parsed = [...segmenter.segment(raw)].map(s => s.segment).filter(s => s.trim());
                else parsed = list;
                await window.electronAPI.setSetting('emojiList', parsed);
                showToast('Emoji list saved');
            };

            // Theme toggle
            overlay.querySelectorAll('.set-theme-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const theme = btn.dataset.theme;
                    await window.electronAPI.setSetting('theme', theme);
                    await applyTheme(theme);
                    overlay.querySelectorAll('.set-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
                });
            });
            document.getElementById('btn-open-themes-folder').addEventListener('click', async () => {
                await window.electronAPI.openCustomThemeFolder();
            });
            document.getElementById('btn-refresh-themes').addEventListener('click', async () => {
                const sel = document.getElementById('custom-theme-select');
                const themes = await window.electronAPI.listCustomThemes();
                const cur = sel.value;
                sel.innerHTML = themes.map(f => `<option value="${f}" ${f===cur?'selected':''}>${f}</option>`).join('');
            });
            document.getElementById('btn-apply-theme').addEventListener('click', async () => {
                const sel = document.getElementById('custom-theme-select');
                await window.electronAPI.setSetting('customThemeFile', sel.value);
                await applyTheme('custom');
                await window.electronAPI.setSetting('theme', 'custom');
                overlay.querySelectorAll('.set-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === 'custom'));
                showToast('Applied: ' + sel.value);
            });
            document.getElementById('set-server-mode').addEventListener('change', (e) => {
                const v = e.target.value;
                document.getElementById('remote-url-row').style.display = v !== 'local' ? 'flex' : 'none';
                document.getElementById('remote-auth-row').style.display = v === 'remote-auth' ? 'flex' : 'none';
                if (v === 'local') {
                    window.electronAPI.setSetting('useRemote', false);
                    window.electronAPI.setSetting('remoteUser', '');
                    window.electronAPI.setSetting('remotePass', '');
                    location.reload();
                }
            });
            document.getElementById('btn-connect-remote').addEventListener('click', async () => {
                const url = document.getElementById('set-remote-url').value.trim();
                if (!url) return;
                const mode = document.getElementById('set-server-mode').value;
                const testHeaders = { 'Content-Type': 'application/json' };
                if (mode === 'remote-auth') {
                    const u = document.getElementById('set-remote-user').value.trim();
                    const p = document.getElementById('set-remote-pass').value;
                    if (u && p) testHeaders['Authorization'] = 'Basic ' + btoa(u + ':' + p);
                }
                try {
                    const res = await fetch(url.replace(/\/$/, '') + '/api/projects', { headers: testHeaders, signal: AbortSignal.timeout(5000) });
                    if (!res.ok) throw new Error(res.status);
                } catch (e) {
                    showToast('Connection failed: ' + (e.message || 'unreachable'));
                    return;
                }
                await window.electronAPI.setSetting('remoteURL', url);
                if (mode === 'remote-auth') {
                    await window.electronAPI.setSetting('remoteUser', document.getElementById('set-remote-user').value.trim());
                    await window.electronAPI.setSetting('remotePass', document.getElementById('set-remote-pass').value);
                } else {
                    await window.electronAPI.setSetting('remoteUser', '');
                    await window.electronAPI.setSetting('remotePass', '');
                }
                await window.electronAPI.setSetting('useRemote', true);
                location.reload();
            });
            document.getElementById('btn-quick-local').addEventListener('click', async () => {
                if (!savedUseRemote && isLocalBase()) return;
                await window.electronAPI.setSetting('useRemote', false);
                location.reload();
            });
            document.getElementById('btn-quick-remote').addEventListener('click', async () => {
                if (savedUseRemote && !isLocalBase()) return;
                const url = await window.electronAPI.getSetting('remoteURL');
                if (!url) { showToast('No remote URL configured'); return; }
                await window.electronAPI.setSetting('useRemote', true);
                location.reload();
            });

            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });

            // Shortcut recorder
            document.getElementById('set-shortcut-change').onclick = () => {
                const display = document.getElementById('set-shortcut-display');
                display.textContent = 'Press new shortcut...';
                display.style.color = '#ffcc00';
                const handler = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (['Control','Shift','Alt','Meta'].includes(e.key)) return;
                    const parts = [];
                    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
                    if (e.shiftKey) parts.push('Shift');
                    if (e.altKey) parts.push('Alt');
                    const codeMap = { Space:'Space',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',
                        Backspace:'Backspace',Delete:'Delete',Enter:'Enter',Escape:'Escape',Tab:'Tab' };
                    let key = codeMap[e.code] || (e.code.startsWith('Key') ? e.code.slice(3) :
                        e.code.startsWith('Digit') ? e.code.slice(5) : e.code);
                    parts.push(key);
                    const captured = parts.join('+');
                    display.textContent = captured;
                    display.style.color = '';
                    document.removeEventListener('keydown', handler, true);
                    (async () => {
                        const result = await window.electronAPI.setShortcut(captured);
                        if (!result.success) { display.textContent = 'Failed — may conflict'; display.style.color = 'var(--danger)'; }
                        else showToast('Shortcut updated');
                    })();
                };
                document.addEventListener('keydown', handler, true);
            };

            // Zoom shortcut recorder
            document.getElementById('set-zoom-shortcut-change').onclick = () => {
                const display = document.getElementById('set-zoom-shortcut-display');
                display.textContent = 'Press new shortcut...';
                display.style.color = '#ffcc00';
                const handler = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (['Control','Shift','Alt','Meta'].includes(e.key)) return;
                    const parts = [];
                    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
                    if (e.shiftKey) parts.push('Shift');
                    if (e.altKey) parts.push('Alt');
                    const codeMap = { Space:'Space',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',
                        Backspace:'Backspace',Delete:'Delete',Enter:'Enter',Escape:'Escape',Tab:'Tab' };
                    let key = codeMap[e.code] || (e.code.startsWith('Key') ? e.code.slice(3) :
                        e.code.startsWith('Digit') ? e.code.slice(5) : e.code);
                    parts.push(key);
                    const captured = parts.join('+');
                    localStorage.setItem('zoom-shortcut', captured);
                    display.textContent = captured;
                    display.style.color = '';
                    document.removeEventListener('keydown', handler, true);
                    showToast('Zoom shortcut updated');
                };
                document.addEventListener('keydown', handler, true);
            };

            // New project
            document.getElementById('set-new-proj').onclick = async () => {
                const row = document.createElement('div');
                row.className = 'set-proj-row';
                row.innerHTML = '<input id="set-new-name" class="set-input" placeholder="Project name"><button id="set-new-ok" class="set-btn-primary">Create</button>';
                document.getElementById('set-proj-list').prepend(row);
                const inp = document.getElementById('set-new-name');
                inp.focus();
                const doCreate = async () => {
                    const name = inp.value.trim();
                    if (!name) { row.remove(); return; }
                    try {
                        const r = await fetch(`${baseURL}/api/projects/create`, {
                            method: 'POST', headers: {'Content-Type':'application/json'},
                            body: JSON.stringify({ name })
                        });
                        const d = await r.json();
                        if (d.error) { showToast(d.error); return; }
                        await loadProjects();
                        showToast(`Project "${name}" created`);
                        closeSettings();
                    } catch (e) { showToast('Failed'); }
                };
                document.getElementById('set-new-ok').onclick = doCreate;
                inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') row.remove(); });
            };

            // Import project
            document.getElementById('set-import-proj').onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.zip,.rbproject.zip';
                input.addEventListener('change', async () => {
                    if (!input.files[0]) return;
                    const form = new FormData();
                    form.append('file', input.files[0]);
                    try {
                        const res = await fetch(`${baseURL}/api/projects/import`, {
                            method: 'POST', body: form
                        });
                        const d = await res.json();
                        if (d.error) { showToast(d.error); return; }
                        await loadProjects();
                        showToast(`Imported project "${d.name}"`);
                        closeSettings();
                    } catch (e) { showToast('Import failed'); }
                });
                input.click();
            };

            // Export / Rename / Delete
            document.getElementById('set-proj-list').addEventListener('click', async (e) => {
                const exportBtn = e.target.closest('.set-proj-export');
                const renameBtn = e.target.closest('.set-proj-rename');
                const deleteBtn = e.target.closest('.set-proj-delete');
                if (exportBtn) {
                    const name = exportBtn.dataset.name;
                    const a = document.createElement('a');
                    a.href = `${baseURL}/api/projects/${encodeURIComponent(name)}/export`;
                    a.download = `${name}.rbproject.zip`;
                    a.click();
                    showToast(`Exporting "${name}"...`);
                }
                if (renameBtn) {
                    const name = renameBtn.dataset.name;
                    const row = renameBtn.closest('.set-proj-row');
                    const nameSpan = row.querySelector('.set-proj-name');
                    const actionsDiv = row.querySelector('.set-proj-actions');
                    const oldText = nameSpan.textContent;
                    actionsDiv.style.display = 'none';
                    nameSpan.innerHTML = `<input class="set-input" style="width:100%;" value="${name}">`;
                    const inp = nameSpan.querySelector('input');
                    inp.focus(); inp.select();
                    const doRename = async () => {
                        const newName = inp.value.trim();
                        if (!newName || newName === name) { nameSpan.textContent = oldText; actionsDiv.style.display = ''; return; }
                        try {
                            const r = await fetch(`${baseURL}/api/projects/rename`, {
                                method: 'POST', headers: {'Content-Type':'application/json'},
                                body: JSON.stringify({ oldName: name, newName })
                            });
                            const d = await r.json();
                            if (d.error) { showToast(d.error); nameSpan.textContent = oldText; actionsDiv.style.display = ''; return; }
                            if (currentProject === name) currentProject = newName;
                            await loadProjects();
                            showToast(`Renamed to "${newName}"`);
                            closeSettings();
                        } catch (e) { showToast('Rename failed'); nameSpan.textContent = oldText; actionsDiv.style.display = ''; }
                    };
                    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') { nameSpan.textContent = oldText; actionsDiv.style.display = ''; } });
                    inp.addEventListener('blur', () => { if (nameSpan.contains(inp)) { nameSpan.textContent = oldText; actionsDiv.style.display = ''; } });
                }
                if (deleteBtn) {
                    const name = deleteBtn.dataset.name;
                    if (name === currentProject) { showToast('Cannot delete active project'); return; }
                    deleteBtn.closest('.set-proj-row').style.opacity = '0.4';
                    try {
                        const r = await fetch(`${baseURL}/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
                        const d = await r.json();
                        if (d.error) { showToast(d.error); deleteBtn.closest('.set-proj-row').style.opacity = '1'; return; }
                        deleteBtn.closest('.set-proj-row').remove();
                        await loadProjects();
                        showToast(`Project "${name}" deleted`);
                    } catch (e) { showToast('Delete failed'); }
                }
            });
        }

        // --- In-editor find bar (Cmd+F) ---
        function openEditorFind() {
            const editor = document.getElementById('editor-content');
            if (!editor) return;
            let bar = document.getElementById('editor-find-bar');
            if (bar) { bar.querySelector('input').focus(); bar.querySelector('input').select(); return; }
            const editorArea = document.getElementById('editor-area');
            if (!editorArea.classList.contains('active')) return;

            bar = document.createElement('div');
            bar.id = 'editor-find-bar';
            bar.style.cssText = 'position:absolute;top:8px;right:18px;z-index:9000;display:flex;align-items:center;gap:4px;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:3px 6px;box-shadow:0 4px 12px var(--shadow);';
            bar.innerHTML = `
                <input id="editor-find-input" type="text" placeholder="Find in note" style="background:transparent;border:none;outline:none;color:var(--text);font-size:12px;width:160px;">
                <span id="editor-find-count" style="font-size:11px;color:var(--text-muted);min-width:42px;text-align:right;">0/0</span>
                <button id="editor-find-prev" style="background:none;border:none;color:var(--text);cursor:pointer;padding:2px 6px;font-size:11px;">↑</button>
                <button id="editor-find-next" style="background:none;border:none;color:var(--text);cursor:pointer;padding:2px 6px;font-size:11px;">↓</button>
                <button id="editor-find-close" style="background:none;border:none;color:var(--text);cursor:pointer;padding:2px 6px;font-size:13px;">✕</button>
            `;
            if (getComputedStyle(editorArea).position === 'static') editorArea.style.position = 'relative';
            editorArea.appendChild(bar);

            let matches = [];
            let activeIdx = -1;
            const HL_CLASS = 'find-hl';
            const HL_ACTIVE_CLASS = 'find-hl-active';

            // Inject highlight styles once
            if (!document.getElementById('editor-find-style')) {
                const s = document.createElement('style');
                s.id = 'editor-find-style';
                s.textContent = `.${HL_CLASS}{background:rgba(255,235,59,0.45);border-radius:2px;}.${HL_ACTIVE_CLASS}{background:rgba(255,152,0,0.85);color:#000;}`;
                document.head.appendChild(s);
            }

            function clearHighlights() {
                editor.querySelectorAll('.' + HL_CLASS + ',.' + HL_ACTIVE_CLASS).forEach(el => {
                    const parent = el.parentNode;
                    parent.replaceChild(document.createTextNode(el.textContent), el);
                    parent.normalize();
                });
                matches = [];
                activeIdx = -1;
            }

            function highlight(query) {
                clearHighlights();
                if (!query) { updateCount(); return; }
                const q = query.toLowerCase();
                const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
                    acceptNode: (n) => {
                        // Skip text inside code blocks and toolbars
                        if (n.parentElement && (n.parentElement.closest('.code-block') || n.parentElement.closest('.cb'))) return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                });
                const textNodes = [];
                let node;
                while ((node = walker.nextNode())) textNodes.push(node);
                for (const tn of textNodes) {
                    const text = tn.textContent;
                    const lower = text.toLowerCase();
                    let idx = lower.indexOf(q);
                    if (idx === -1) continue;
                    const frag = document.createDocumentFragment();
                    let last = 0;
                    while (idx !== -1) {
                        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
                        const span = document.createElement('span');
                        span.className = HL_CLASS;
                        span.textContent = text.slice(idx, idx + query.length);
                        frag.appendChild(span);
                        matches.push(span);
                        last = idx + query.length;
                        idx = lower.indexOf(q, last);
                    }
                    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
                    tn.parentNode.replaceChild(frag, tn);
                }
                if (matches.length) setActive(0);
                updateCount();
            }

            function setActive(i) {
                if (!matches.length) return;
                matches.forEach(m => m.classList.remove(HL_ACTIVE_CLASS));
                activeIdx = ((i % matches.length) + matches.length) % matches.length;
                const m = matches[activeIdx];
                m.classList.add(HL_ACTIVE_CLASS);
                m.scrollIntoView({ block: 'center', behavior: 'smooth' });
                updateCount();
            }

            function updateCount() {
                const c = document.getElementById('editor-find-count');
                if (c) c.textContent = matches.length ? `${activeIdx + 1}/${matches.length}` : '0/0';
            }

            function close() {
                clearHighlights();
                bar.remove();
                editor.focus();
            }

            const input = document.getElementById('editor-find-input');
            input.addEventListener('input', () => highlight(input.value));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) setActive(activeIdx - 1); else setActive(activeIdx + 1);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                }
            });
            document.getElementById('editor-find-prev').onclick = () => setActive(activeIdx - 1);
            document.getElementById('editor-find-next').onclick = () => setActive(activeIdx + 1);
            document.getElementById('editor-find-close').onclick = close;

            // Pre-fill with current selection if any
            const selText = window.getSelection().toString();
            if (selText && selText.length < 80) {
                input.value = selText;
                highlight(selText);
            }
            input.focus();
            input.select();
        }

        // --- Search ---
        function openSearch() {
            window.electronAPI.lockBlur();
            const overlay = document.createElement('div');
            overlay.id = 'search-overlay';
            overlay.className = 'search-overlay';

            overlay.innerHTML = `
            <div class="search-panel">
                <div class="search-header">
                    <input type="text" id="search-input" placeholder="Search todos (title, content, ID)..." autocomplete="off">
                </div>
                <div class="search-filters">
                    <button class="search-filter-btn active" data-filter="all">All</button>
                    <button class="search-filter-btn" data-filter="title">Title</button>
                    <button class="search-filter-btn" data-filter="content">Content</button>
                </div>
                <div class="search-results" id="search-results">
                    <div class="search-empty">Type to search</div>
                </div>
            </div>`;
            document.body.appendChild(overlay);

            const input = document.getElementById('search-input');
            const resultsList = document.getElementById('search-results');
            let allResults = [];
            let currentFilter = 'all';
            let highlightIdx = -1;
            let debounceTimer = null;

            input.focus();

            function stripHtml(html) {
                const tmp = document.createElement('div');
                tmp.innerHTML = html || '';
                return tmp.textContent || '';
            }

            function filterResults() {
                if (currentFilter === 'all') return allResults;
                const q = input.value.trim().toLowerCase();
                if (!q) return allResults;
                return allResults.filter(r => {
                    if (currentFilter === 'title') return r.title && r.title.toLowerCase().includes(q);
                    if (currentFilter === 'content') return r.content && stripHtml(r.content).toLowerCase().includes(q);
                    return true;
                });
            }

            function renderResults() {
                const filtered = filterResults();
                highlightIdx = -1;
                if (filtered.length === 0) {
                    resultsList.innerHTML = `<div class="search-empty">${input.value.trim() ? 'No results' : 'Type to search'}</div>`;
                    return;
                }
                resultsList.innerHTML = filtered.map((r, i) => {
                    const snippet = stripHtml(r.content).slice(0, 80);
                    const shortId = r.id ? r.id.substring(0, 8) : '';
                    return `<div class="search-item" data-idx="${i}">
                        <div class="search-item-top">
                            <span class="search-item-date">${r.date}</span>
                            <span class="search-item-title">${esc(r.title || 'Untitled')}</span>
                            ${shortId ? `<span class="search-item-id" title="${esc(r.id || '')}">${shortId}</span>` : ''}
                        </div>
                        ${snippet ? `<div class="search-item-snippet">${esc(snippet)}</div>` : ''}
                    </div>`;
                }).join('');
            }

            function selectResult(idx) {
                const filtered = filterResults();
                const r = filtered[idx];
                if (!r) return;
                closeSearch();
                selectedDate = r.date;
                renderDayTabs();
                updateTitle();
                loadTodos().then(() => {
                    const todo = todos.find(t => t.id === r.id);
                    if (todo) openEditor(todo);
                });
            }

            function updateHighlight(newIdx) {
                const items = resultsList.querySelectorAll('.search-item');
                if (items.length === 0) return;
                highlightIdx = Math.max(0, Math.min(newIdx, items.length - 1));
                items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
                items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
            }

            async function doSearch() {
                const q = input.value.trim();
                if (!q) { allResults = []; renderResults(); return; }
                try {
                    const res = await fetch(`${baseURL}/api/search?q=${encodeURIComponent(q)}`, { headers: headers() });
                    allResults = (await res.json()).reverse();
                    renderResults();
                } catch (e) { resultsList.innerHTML = '<div class="search-empty">Search failed</div>'; }
            }

            input.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(doSearch, 300);
            });

            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'ArrowDown') { e.preventDefault(); updateHighlight(highlightIdx + 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); updateHighlight(highlightIdx - 1); }
                else if (e.key === 'Enter' && highlightIdx >= 0) { e.preventDefault(); selectResult(highlightIdx); }
                else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
            });

            resultsList.addEventListener('click', (e) => {
                const idBadge = e.target.closest('.search-item-id');
                if (idBadge) {
                    e.stopPropagation();
                    navigator.clipboard.writeText(idBadge.title);
                    showToast('ID 已复制: ' + idBadge.title);
                    return;
                }
                const item = e.target.closest('.search-item');
                if (item) selectResult(parseInt(item.dataset.idx));
            });

            overlay.querySelectorAll('.search-filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    overlay.querySelectorAll('.search-filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentFilter = btn.dataset.filter;
                    renderResults();
                });
            });

            const closeSearch = () => { overlay.remove(); window.electronAPI.unlockBlur(); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });
        }

        // --- Resizer (left panel width) ---
        (() => {
            const resizer = document.getElementById('resizer');
            const leftPanel = document.querySelector('.left-panel');
            (async () => {
                const w = await window.electronAPI.getSetting('leftPanelWidth');
                if (w && typeof w === 'number') leftPanel.style.width = w + 'px';
            })();
            let dragging = false;
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dragging = true;
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
            window.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const container = document.querySelector('.main-content');
                const rect = container.getBoundingClientRect();
                const w = Math.max(160, Math.min(rect.width - 200, e.clientX - rect.left));
                leftPanel.style.width = w + 'px';
            });
            window.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                const w = parseInt(leftPanel.style.width, 10);
                if (w) window.electronAPI.setSetting('leftPanelWidth', w);
            });
        })();

        let pinned = false;
        document.getElementById('pin-btn').addEventListener('click', () => {
            pinned = !pinned;
            document.getElementById('pin-btn').style.opacity = pinned ? '1' : '0.5';
            window.electronAPI.setPinned(pinned);
            idleHidePinned = pinned;
            armIdleTimer();
        });
        document.getElementById('pin-btn').style.opacity = '0.5';
        document.getElementById('search-btn').addEventListener('click', () => {
            if (!document.getElementById('search-overlay')) openSearch();
        });


        // --- Calendar picker ---
        document.getElementById('cal-btn').addEventListener('click', () => {
            const inp = document.getElementById('cal-input');
            inp.style.pointerEvents = 'auto';
            inp.showPicker();
        });
        document.getElementById('cal-input').addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                selectedDate = val;
                renderDayTabs();
                closeEditor();
                loadTodos();
                updateTitle();
            }
            e.target.style.pointerEvents = 'none';
        });

        // --- Editor date bar ---
        function updateEditorDateBar() {
            const todoDate = editingTodo ? (editingTodo.date || selectedDate) : null;
            const datePick = document.getElementById('editor-date-pick');
            if (!editingTodo) {
                datePick.style.display = 'none';
                return;
            }
            datePick.style.display = '';
            datePick.value = (todoDate === 'overdue' || todoDate === 'future') ? todayStr : todoDate;
        }

        async function moveTodoToDate(newDate) {
            if (!editingTodo) return;
            const oldDate = editingTodo.date || selectedDate;
            if (oldDate === newDate) return;
            // Delete from old date
            await fetch(`${baseURL}/api/todos/delete`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ date: oldDate, id: editingTodo.id })
            });
            // Save to new date
            editingTodo.date = newDate;
            await fetch(`${baseURL}/api/todos`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ date: newDate, todo: editingTodo })
            });
            closeEditor();
            await loadTodos();
        }

        document.getElementById('editor-date-pick').addEventListener('change', (e) => {
            if (e.target.value) moveTodoToDate(e.target.value);
        });


        // --- Keys ---
        document.addEventListener('keydown', (e) => {
            // ⌘S / Ctrl+S — Save to server (overwrite)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                manualSave();
                return;
            }
            if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!document.getElementById('settings-overlay')) openSettings();
                return;
            }
            // ⌘+ / ⌘= / ⌘- / ⌘0 — UI zoom
            if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
                e.preventDefault(); setZoom(uiZoom + 0.1); return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === '-') {
                e.preventDefault(); setZoom(uiZoom - 0.1); return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === '0') {
                e.preventDefault(); setZoom(1); return;
            }
            // ⌘R — refresh (re-load page so date / week-tabs update after midnight)
            if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                location.reload();
                return;
            }
            // ⌘O — global search across todos (was ⌘F)
            if (e.key === 'o' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!document.getElementById('search-overlay')) openSearch();
                return;
            }
            // ⌘F — find within currently-open editor
            if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (editingTodo) openEditorFind();
                return;
            }
            // ⌘⇧Z (or configured) — toggle zoom editor
            if (editingTodo) {
                const zs = (localStorage.getItem('zoom-shortcut') || 'CommandOrControl+L').split('+');
                const wantCmd = zs.includes('CommandOrControl');
                const wantShift = zs.includes('Shift');
                const wantAlt = zs.includes('Alt');
                const wantKey = zs.filter(k => !['CommandOrControl','Shift','Alt'].includes(k))[0] || '';
                const modMatch = (wantCmd ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey))
                    && (wantShift ? e.shiftKey : !e.shiftKey)
                    && (wantAlt ? e.altKey : !e.altKey);
                const keyMatch = e.key.toLowerCase() === wantKey.toLowerCase()
                    || e.code === `Key${wantKey.toUpperCase()}`
                    || e.code === `Digit${wantKey}`;
                if (modMatch && keyMatch) {
                    e.preventDefault();
                    document.getElementById('tb-zoom').click();
                    return;
                }
            }
            const editorFocused = document.getElementById('editor-area').contains(document.activeElement);
            const inputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
            if (!editorFocused && !inputFocused && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                if (todos.length === 0) return;
                const currentIdx = editingTodo ? todos.findIndex(t => t.id === editingTodo.id) : -1;
                let nextIdx;
                if (e.key === 'ArrowDown') {
                    nextIdx = currentIdx < todos.length - 1 ? currentIdx + 1 : 0;
                } else {
                    nextIdx = currentIdx > 0 ? currentIdx - 1 : todos.length - 1;
                }
                openEditor(todos[nextIdx]);
                const items = document.querySelectorAll('.task-item');
                if (items[nextIdx]) items[nextIdx].scrollIntoView({ block: 'nearest' });
                return;
            }
            if (!editorFocused && !inputFocused && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                flushSaveSync();
                const allDates = ['overdue', ...weekDates, 'future'];
                let idx = allDates.indexOf(selectedDate);
                if (idx === -1) idx = allDates.indexOf(todayStr);
                if (idx === -1) idx = 0;
                if (e.key === 'ArrowLeft') {
                    if (idx > 0) {
                        idx--;
                    } else {
                        weekOffset--;
                        weekDates = getWeekDates(weekOffset);
                        idx = weekDates.length + 1; // 'future' of prev week
                    }
                } else {
                    if (idx < allDates.length - 1) {
                        idx++;
                    } else if (weekOffset < 0) {
                        weekOffset++;
                        weekDates = getWeekDates(weekOffset);
                        idx = 0; // 'overdue' of next week
                    } else {
                        idx = 0; // wrap at current week boundary
                    }
                }
                const newAllDates = ['overdue', ...weekDates, 'future'];
                selectedDate = newAllDates[idx] || todayStr;
                renderDayTabs();
                editingTodo = null;
                document.getElementById('editor-empty').style.display = 'flex';
                document.getElementById('editor-area').classList.remove('active');
                updateEditorDateBar();
                loadTodos();
                updateTitle();
                return;
            }
            if (e.key === 'Escape') {
                const emojiPanel = document.querySelector('.emoji-panel');
                if (emojiPanel) { e.preventDefault(); emojiPanel.remove(); return; }
                const findBar = document.getElementById('editor-find-bar');
                if (findBar) { e.preventDefault(); findBar.querySelector('#editor-find-close').click(); return; }
                const searchOverlay = document.getElementById('search-overlay');
                const settingsOverlay = document.getElementById('settings-overlay');
                if (searchOverlay) {
                    searchOverlay.remove();
                    window.electronAPI.unlockBlur();
                } else if (settingsOverlay) {
                    settingsOverlay.remove();
                    window.electronAPI.unlockBlur();
                } else if (isZoomed) {
                    isZoomed = false;
                    document.body.classList.remove('zoomed');
                    document.body.classList.remove('toolbar-visible');
                    document.getElementById('tb-zoom').textContent = '⛶';
                    document.getElementById('tb-zoom').title = 'Zoom editor (Ctrl+Shift+Z)';
                } else if (editingTodo) {
                    // Use async save (sync XHR fallback is unreliable, esp. with remote auth)
                    (async () => {
                        try {
                            if (isDirty) {
                                await flushSave();
                                showToast('Saved');
                            }
                        } catch (err) { console.warn('ESC save failed:', err); }
                        editingTodo = null;
                        isDirty = false;
                        document.getElementById('editor-empty').style.display = 'flex';
                        document.getElementById('editor-area').classList.remove('active');
                        updateEditorDateBar();
                        renderList();
                    })();
                } else {
                    (async () => {
                        try {
                            if (isDirty) {
                                await flushSave();
                                showToast('Saved');
                            }
                        } catch {}
                        window.electronAPI.hidePanel();
                    })();
                }
            }
        });

        // Only upload on hide/blur when there are unsaved edits (no more constant remote writes).
        window.addEventListener('blur', () => { if (isDirty) flushSaveSync(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden && isDirty) flushSaveSync(); });

        init();
    
