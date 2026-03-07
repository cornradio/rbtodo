const state = {
    selectedDate: dayjs().format('YYYY-MM-DD'),
    selectedTodo: null,
    todos: [],
    oldTodos: [],
    highlightedDates: [],
    isDarkMode: false,
    timelineStats: {},
    isFullscreen: false,
    isSidebarCollapsed: false,
    calendarViewDate: dayjs().startOf('month'),
    isAllTasksView: false,
    allTodos: [],
    currentLightboxIndex: -1,
    activeNoteImages: [],
    isCompressionEnabled: localStorage.getItem('img-compression') === 'true',
    lastSyncCheck: null,
    sessionId: getSessionId(),
    isReadOnly: false,
    lockHeartbeatInterval: null,
    autoUnlockInterval: null,
    lockDurationInterval: null
};

function getSessionId() {
    let id = sessionStorage.getItem('todo_session_id');
    if (!id) {
        id = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('todo_session_id', id);
    }
    return id;
}

// --- DOM Elements ---
const timelineEl = document.getElementById('timeline');
const calendarEl = document.getElementById('calendar');
const oldTodosEl = document.getElementById('old-todos-list');
const todayTodosEl = document.getElementById('today-todos-list');
const allTodosEl = document.getElementById('all-todos-list');
const oldTodosSection = document.getElementById('old-todos-section');
const todayTodosSection = document.getElementById('today-todos-section');
const allTodosSection = document.getElementById('all-todos-section');
const editorSection = document.getElementById('editor-container');
const editorPlaceholder = document.getElementById('editor-placeholder');
const titleInput = document.getElementById('todo-title-input');
const contentEditor = document.getElementById('todo-content-editor');
const dateTitle = document.getElementById('current-date-title');
const saveStatus = document.getElementById('save-status');
const themeToggle = document.getElementById('theme-toggle');
const resizer = document.getElementById('resizer');
const editorPane = document.getElementById('editor-section');
const sidebar = document.getElementById('sidebar');
const app = document.getElementById('app');
const searchInput = document.getElementById('search-input');
const searchOverlay = document.getElementById('search-overlay');
const searchResultsList = document.getElementById('search-results-list');
const closeSearchBtn = document.getElementById('close-search');

const exportModal = document.getElementById('export-modal');
const exportTextarea = document.getElementById('export-textarea');
const closeExportBtn = document.getElementById('close-export');
const copyExportBtn = document.getElementById('copy-export');
const exportWeekBtn = document.getElementById('export-week-btn');

const lightboxModal = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const imageListModal = document.getElementById('image-list-modal');
const imageGrid = document.getElementById('image-grid');
const picCountBtn = document.getElementById('note-pic-count');

const toggleSidebarBtn = document.getElementById('toggle-sidebar-persistent');
const fullscreenBtn = document.getElementById('fullscreen-editor');

// --- Mobile Elements ---
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileSearchBtn = document.getElementById('mobile-search-btn');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const openSearchBtn = document.getElementById('open-search-btn');
const manualReloadBtn = document.getElementById('manual-reload');
const listManualReloadBtn = document.getElementById('list-manual-reload');
const listSaveStatus = document.getElementById('list-save-status');
const listTotalStats = document.getElementById('list-total-stats');

// --- Initialization ---
async function init() {
    setupEventListeners();
    setupKeyboardShortcuts();
    registerServiceWorker();
    await fetchHighlightedDates();
    await fetchTimelineStats();
    renderTimeline();
    renderCalendar();
    await loadTodos();
    checkPrefersColorScheme();
    initResizer();
    setupImageResizing();

    // Attempt to unlock on close
    window.addEventListener('beforeunload', () => {
        if (state.selectedTodo) {
            const data = JSON.stringify({ id: state.selectedTodo.id, sessionId: state.sessionId });
            const blob = new Blob([data], { type: 'application/json' });
            navigator.sendBeacon('/api/unlock', blob);
        }
    });
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then(reg => {
                console.log('SW registered:', reg);
            }).catch(err => {
                console.log('SW registration failed:', err);
            });
        });
    }
}

function setupEventListeners() {
    document.getElementById('add-todo-btn').addEventListener('click', createNewTodo);
    document.getElementById('close-editor-top').addEventListener('click', closeEditor);

    titleInput.addEventListener('input', debounce(autoSave, 1000));
    contentEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const container = range.commonAncestorContainer;

                // If we are inside an LI or the selection contains LIs, allow indent/outdent
                const isLI = container.nodeType === 3 ? container.parentNode.closest('li') : (container.closest ? container.closest('li') : null);
                const hasLI = container.querySelectorAll ? container.querySelectorAll('li').length > 0 : false;

                if (isLI || hasLI) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        document.execCommand('outdent', false, null);
                    } else {
                        document.execCommand('indent', false, null);
                    }
                }
            }
        }
    });

    // Paste image support
    contentEditor.addEventListener('paste', handlePaste);
    contentEditor.addEventListener('input', debounce(() => {
        console.log('Auto-saving due to input...');
        autoSave();
    }, 1500));

    contentEditor.addEventListener('blur', () => {
        linkify(contentEditor);
        autoSave();
    });

    // Fix link clicking in contenteditable
    contentEditor.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link) {
            e.preventDefault();
            window.open(link.href, '_blank');
        }
    });

    // Drag & Drop image support
    contentEditor.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    contentEditor.addEventListener('drop', async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                await uploadAndInsertImage(file);
            }
        }
    });

    document.getElementById('image-upload').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            await uploadAndInsertImage(file);
        }
        e.target.value = ''; // Reset input
    });

    const compressToggle = document.getElementById('compression-toggle');
    if (compressToggle) {
        compressToggle.classList.toggle('active', state.isCompressionEnabled);
        compressToggle.addEventListener('click', () => {
            state.isCompressionEnabled = !state.isCompressionEnabled;
            localStorage.setItem('img-compression', state.isCompressionEnabled);
            compressToggle.classList.toggle('active', state.isCompressionEnabled);
        });
    }

    themeToggle.addEventListener('click', toggleTheme);

    // Search
    openSearchBtn.addEventListener('click', openSearch);
    searchInput.addEventListener('input', debounce(handleSearch, 500));
    closeSearchBtn.addEventListener('click', () => searchOverlay.classList.add('hidden'));
    searchOverlay.addEventListener('click', (e) => {
        if (e.target === searchOverlay) searchOverlay.classList.add('hidden');
    });

    // Sidebar Collapse
    toggleSidebarBtn.addEventListener('click', toggleSidebar);

    // Fullscreen
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Delete
    document.getElementById('delete-todo').addEventListener('click', () => {
        if (confirm('Permanently delete this todo?')) {
            deleteCurrentTodo();
        }
    });

    // Export
    exportWeekBtn.addEventListener('click', handleExport);
    closeExportBtn.addEventListener('click', () => exportModal.classList.add('hidden'));
    copyExportBtn.addEventListener('click', () => {
        exportTextarea.select();
        document.execCommand('copy');
        copyExportBtn.textContent = 'Copied!';
        setTimeout(() => copyExportBtn.textContent = 'Copy Text', 2000);
    });

    // Mobile Event Listeners
    mobileMenuBtn?.addEventListener('click', toggleMobileSidebar);
    mobileSearchBtn?.addEventListener('click', openSearch);
    drawerBackdrop?.addEventListener('click', closeAllDrawers);

    manualReloadBtn?.addEventListener('click', manualReloadTodo);
    listManualReloadBtn?.addEventListener('click', async () => {
        listManualReloadBtn.classList.add('spinning');
        await loadTodos();
        listManualReloadBtn.classList.remove('spinning');
    });

    // Toolbar Actions
    document.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const command = btn.dataset.command;
            const value = btn.dataset.value;
            handleToolbarAction(command, value);
        });
    });

    // Custom Color Picker
    const colorPickerTrigger = document.getElementById('color-picker-btn');
    const colorInput = document.getElementById('custom-color-picker');
    colorPickerTrigger?.addEventListener('click', (e) => {
        if (e.target !== colorInput) {
            colorInput.click();
        }
    });
    colorInput?.addEventListener('input', (e) => {
        handleToolbarAction('foreColor', e.target.value);
    });

    // Link Creation
    document.getElementById('create-link-btn')?.addEventListener('click', createLink);

    document.getElementById('copy-html-btn').addEventListener('click', copyAsHtml);

    // Date Picker for Todo
    const noteDateEl = document.getElementById('note-date');
    const datePicker = document.getElementById('todo-date-picker');
    noteDateEl?.addEventListener('click', () => {
        if (!state.selectedTodo) return;
        datePicker.value = (state.selectedTodo.date || state.selectedDate).split(' ')[0];
        // Ensure browser knows focus is here for picker anchoring
        datePicker.focus();
        datePicker.showPicker?.() || datePicker.click();
    });

    datePicker?.addEventListener('change', async () => {
        const newDate = datePicker.value;
        if (!newDate || !state.selectedTodo) return;

        const oldDate = state.selectedTodo.date || state.selectedDate;
        if (newDate === oldDate) return;

        if (confirm(`Move this todo to ${newDate}?`)) {
            const todo = state.selectedTodo;
            const previousDate = oldDate;
            todo.date = newDate;

            await saveTodoData(todo);
            await fetch('/api/todos/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: previousDate, id: todo.id })
            });

            selectDate(newDate);
            openTodo(todo);
            saveStatus.textContent = 'Moved';
        }
    });

    // Clipboard Fallback Modal listeners
    document.getElementById('close-copy-fallback')?.addEventListener('click', () => {
        document.getElementById('copy-fallback-modal').classList.add('hidden');
    });
    document.getElementById('copy-fallback-btn')?.addEventListener('click', () => {
        const textarea = document.getElementById('copy-fallback-textarea');
        textarea.select();
        document.execCommand('copy');
        document.getElementById('copy-fallback-btn').textContent = '✅ Copied via execCommand';
        setTimeout(() => {
            document.getElementById('copy-fallback-btn').textContent = 'Copy to Clipboard (Fallback Method)';
        }, 2000);
    });

    // All Tasks
    const allTasksBtn = document.getElementById('all-tasks-btn');
    allTasksBtn.addEventListener('click', showAllTasks);

    // Lightbox & Image List
    contentEditor.addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            const allImgs = Array.from(contentEditor.querySelectorAll('img')).map(img => img.src);
            const index = allImgs.indexOf(e.target.src);
            state.activeNoteImages = allImgs;
            openLightbox(index);
        }
    });

    picCountBtn?.addEventListener('click', openImageList);
    document.getElementById('close-image-list')?.addEventListener('click', () => imageListModal.classList.add('hidden'));
    document.getElementById('close-lightbox')?.addEventListener('click', closeLightbox);
    document.getElementById('prev-image')?.addEventListener('click', prevLightboxImage);
    document.getElementById('next-image')?.addEventListener('click', nextLightboxImage);
    lightboxModal?.addEventListener('click', (e) => {
        if (e.target === lightboxModal) closeLightbox();
    });

    // Old Todos Collapse
    const oldTodosHeader = document.getElementById('old-todos-header');
    if (oldTodosHeader) {
        oldTodosHeader.addEventListener('click', toggleOldTodosCollapse);
    }
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Ctrl + B: Toggle Sidebar
        if (e.ctrlKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
        // Ctrl + Shift + F: Toggle Fullscreen
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            if (!editorSection.classList.contains('hidden')) {
                toggleFullscreen();
            }
        }
        // Ctrl + P: Open Search (Mac: Cmd + P)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            openSearch();
        }

        // Lightbox Navigation (Arrow Keys)
        if (!lightboxModal.classList.contains('hidden')) {
            if (e.key === 'ArrowRight') nextLightboxImage();
            if (e.key === 'ArrowLeft') prevLightboxImage();
        }

        // Delete key
        if (e.key === 'Delete' && state.selectedTodo) {
            if (document.activeElement.tagName !== 'INPUT' && !document.activeElement.classList.contains('content-editor')) {
                e.preventDefault();
                if (e.shiftKey || confirm('Permanently delete this todo?')) {
                    deleteCurrentTodo();
                }
            }
        }

        // ESC key handling (Layered)
        if (e.key === 'Escape') {
            if (!lightboxModal.classList.contains('hidden')) {
                closeLightbox();
            } else if (!searchOverlay.classList.contains('hidden')) {
                searchOverlay.classList.add('hidden');
            } else if (!imageListModal.classList.contains('hidden')) {
                imageListModal.classList.add('hidden');
            } else if (!exportModal.classList.contains('hidden')) {
                exportModal.classList.add('hidden');
            } else if (!editorPane.classList.contains('hidden-right') && !editorPane.classList.contains('hidden')) {
                closeEditor();
            }
        }

        // Ctrl + L: Insert Link
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
            if (!editorSection.classList.contains('hidden')) {
                e.preventDefault();
                createLink();
            }
        }

        // Ctrl + Q: Open Color Picker / Reset Color
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
            if (!editorSection.classList.contains('hidden')) {
                e.preventDefault();
                if (e.shiftKey) {
                    handleToolbarAction('foreColor', 'clear');
                } else {
                    document.getElementById('custom-color-picker')?.click();
                }
            }
        }
    });
}

function closeEditor() {
    if (state.selectedTodo) {
        releaseLock(state.selectedTodo.id);
    }
    editorPane.classList.add('hidden-right');
    editorPane.classList.add('hidden'); // Ensure no layout impact
    editorPane.classList.remove('mobile-open');
    resizer.classList.add('hidden');
    state.selectedTodo = null;
    if (state.isFullscreen) {
        state.isFullscreen = false;
        editorPane.classList.remove('fullscreen');
        fullscreenBtn.textContent = '⛶';
    }
    updateDrawerBackdrop();
    renderTodoLists();
}

function toggleMobileSidebar() {
    sidebar.classList.toggle('mobile-open');
    updateDrawerBackdrop();
}

function closeAllDrawers() {
    sidebar.classList.remove('mobile-open');
    closeEditor();
}

function updateDrawerBackdrop() {
    if (sidebar.classList.contains('mobile-open') || editorPane.classList.contains('mobile-open')) {
        drawerBackdrop.classList.remove('hidden');
    } else {
        drawerBackdrop.classList.add('hidden');
    }
}

// --- Data Fetching ---
async function fetchHighlightedDates() {
    try {
        const res = await fetch('/api/todo-dates');
        state.highlightedDates = await res.json();
    } catch (e) { console.error(e); }
}

async function fetchTimelineStats() {
    const startOfWeek = dayjs().startOf('isoWeek');
    const dates = [];
    for (let i = 0; i < 7; i++) {
        dates.push(startOfWeek.add(i, 'day').format('YYYY-MM-DD'));
    }

    try {
        const res = await fetch('/api/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dates })
        });
        state.timelineStats = await res.json();
    } catch (e) { console.error(e); }
}

async function loadTodos() {
    try {
        const res = await fetch(`/api/todos?date=${state.selectedDate}`);
        const data = await res.json();
        state.todos = data.todos || [];

        const oldRes = await fetch(`/api/old-todos?date=${state.selectedDate}`);
        state.oldTodos = await oldRes.json();

        renderTodoLists();
        updateDateTitle();
    } catch (e) { console.error(e); }
}

async function saveTodoData(todo) {
    if (state.isReadOnly) return;
    const statusBox = saveStatus.parentElement;
    const listStatusBox = listSaveStatus.parentElement;

    saveStatus.textContent = 'Saving...';
    listSaveStatus.textContent = 'Saving...';
    statusBox.classList.add('saving');
    listStatusBox.classList.add('saving');

    const startTime = Date.now();
    try {
        const response = await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: todo.date || state.selectedDate,
                todo,
                expectedUpdatedAt: todo.updatedAt
            })
        });

        const result = await response.json();

        // Ensure "Saving..." is visible for at least 600ms
        const elapsed = Date.now() - startTime;
        if (elapsed < 600) {
            await new Promise(r => setTimeout(r, 600 - elapsed));
        }

        if (result.status === 'conflict_merged') {
            // A conflict occurred and was merged on the server
            saveStatus.textContent = 'Conflict Merged';
            listSaveStatus.textContent = 'Conflict Merged';

            // Update local state with the merged content and new timestamp
            state.selectedTodo.content = result.mergedContent;
            state.selectedTodo.updatedAt = result.updatedAt;

            // Refresh editor UI if still open
            if (state.selectedTodo.id === todo.id) {
                contentEditor.innerHTML = result.mergedContent;
                updateNoteStats();
            }

            alert('Note clash! Someone else edited this note. We\'ve kept both versions - see the bottom of the note for the conflicting content.');
        } else {
            saveStatus.textContent = 'Saved';
            listSaveStatus.textContent = 'Saved';
            if (result.updatedAt) {
                todo.updatedAt = result.updatedAt;
            }
        }
        statusBox.classList.remove('saving');
        listStatusBox.classList.remove('saving');

        await fetchHighlightedDates();
        await fetchTimelineStats();
        renderTimeline();
        renderCalendar();
    } catch (e) {
        saveStatus.textContent = 'Error';
        listSaveStatus.textContent = 'Error';
        statusBox.classList.remove('saving');
        listStatusBox.classList.remove('saving');
        console.error(e);
    }
}

async function saveTodosOrder(date, todos) {
    saveStatus.textContent = 'Saving order...';
    try {
        await fetch('/api/todos/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, todos })
        });
        saveStatus.textContent = 'Saved';
    } catch (e) {
        saveStatus.textContent = 'Error';
        console.error(e);
    }
}

// --- Rendering Logic ---
function renderTimeline() {
    timelineEl.innerHTML = '';
    const startOfWeek = dayjs().startOf('isoWeek');

    for (let i = 0; i < 7; i++) {
        const d = startOfWeek.add(i, 'day');
        const dateStr = d.format('YYYY-MM-DD');
        const stats = state.timelineStats[dateStr] || { total: 0, completed: 0 };

        const item = document.createElement('div');
        item.className = `timeline-item ${dateStr === state.selectedDate ? 'active' : ''}`;
        item.innerHTML = `
            <div class="date-info">
                <span class="date-label">${d.format('MM-DD')}</span>
                <span class="day-label">${d.format('ddd').toUpperCase()}</span>
            </div>
            <div class="todo-stats">
                <span class="todo-count">${stats.completed}/${stats.total}</span>
                <div style="font-size: 0.6rem">TODO</div>
            </div>
        `;
        item.onclick = () => selectDate(dateStr);
        timelineEl.appendChild(item);
    }
}

function renderCalendar() {
    const viewDate = state.calendarViewDate;
    const startOfMonth = viewDate.startOf('month');
    const endOfMonth = viewDate.endOf('month');
    const startDay = startOfMonth.day();
    const daysInMonth = viewDate.daysInMonth();

    calendarEl.innerHTML = `
        <div class="calendar-grid-labels">
            <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
        </div>
    `;

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    for (let i = 0; i < startDay; i++) {
        grid.appendChild(document.createElement('div'));
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const date = startOfMonth.date(d).format('YYYY-MM-DD');
        const dayEl = document.createElement('div');
        dayEl.className = 'cal-day';
        if (date === state.selectedDate) dayEl.classList.add('today');
        if (state.highlightedDates.includes(date)) dayEl.classList.add('has-todo');
        dayEl.textContent = d;
        dayEl.onclick = () => selectDate(date);
        grid.appendChild(dayEl);
    }
    calendarEl.appendChild(grid);

    // Month Navigation at Bottom
    const nav = document.createElement('div');
    nav.className = 'calendar-header-nav';
    nav.innerHTML = `
        <div class="cal-nav-group">
            <button class="cal-nav-btn" onclick="changeMonth(-1)">❮</button>
            <span class="cal-month-title">${viewDate.format('MMM YYYY')}</span>
            <button class="cal-nav-btn" onclick="changeMonth(1)">❯</button>
        </div>
        <button class="cal-today-btn" onclick="goToday()">Today</button>
    `;
    calendarEl.appendChild(nav);
}

window.changeMonth = (delta) => {
    state.calendarViewDate = state.calendarViewDate.add(delta, 'month');
    renderCalendar();
};

window.goToday = () => {
    state.calendarViewDate = dayjs().startOf('month');
    selectDate(dayjs().format('YYYY-MM-DD'));
};

function renderTodoLists() {
    if (state.isAllTasksView) {
        renderList(state.allTodos, allTodosEl, false);
        oldTodosSection.classList.add('hidden');
        todayTodosSection.classList.add('hidden');
        allTodosSection.classList.remove('hidden');

        listTotalStats.textContent = `${state.allTodos.length} items total`;
        return;
    }

    oldTodosSection.classList.remove('hidden');
    todayTodosSection.classList.remove('hidden');
    allTodosSection.classList.add('hidden');

    renderList(state.oldTodos, oldTodosEl, true);
    renderList(state.todos, todayTodosEl, false);
    const oldFinishedCount = state.oldTodos.filter(t => !t.completed).length;
    const oldBadge = document.getElementById('old-todos-count');
    if (oldBadge) {
        oldBadge.textContent = oldFinishedCount;
        oldBadge.classList.toggle('hidden', oldFinishedCount === 0);
    }

    const remainingCount = state.todos.filter(t => !t.completed).length + oldFinishedCount;
    listTotalStats.textContent = `${remainingCount} item${remainingCount !== 1 ? 's' : ''} remaining`;
}

function renderList(todos, container, isOld) {
    container.innerHTML = '';
    if (todos.length === 0) {
        container.innerHTML = '<p style="font-size:0.85rem; opacity:0.5; padding:10px;">No todos here.</p>';
        return;
    }

    todos.forEach((todo, index) => {
        const item = document.createElement('div');
        item.className = `todo-item ${todo.completed ? 'completed' : ''} ${state.selectedTodo?.id === todo.id ? 'active' : ''}`;
        item.draggable = false;
        item.dataset.id = todo.id;
        item.dataset.index = index;
        item.dataset.isOld = isOld;

        const checkbox = document.createElement('div');
        checkbox.className = `todo-checkbox ${todo.completed ? 'checked' : ''}`;
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleTodoComplete(todo);
        };

        const title = document.createElement('div');
        title.className = 'todo-title';
        title.textContent = todo.title || '(No Title)';

        item.ondblclick = (e) => {
            e.stopPropagation();
            title.contentEditable = true;
            title.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(title);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        };

        title.onblur = () => {
            title.contentEditable = false;
        };

        title.oninput = (e) => {
            todo.title = e.target.textContent;
            if (state.selectedTodo?.id === todo.id) {
                titleInput.value = todo.title;
            }
            debounce(() => saveTodoData(todo), 2000)();
        };

        item.appendChild(checkbox);
        item.appendChild(title);
        item.onclick = () => openTodo(todo);

        // Drag & Drop DISABLED per user request
        /*
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const toIdx = parseInt(item.dataset.index);
            handleDrop(isOld, toIdx);
        });
        item.addEventListener('dragend', handleDragEnd);
        */

        container.appendChild(item);
    });

    // Drag & Drop Containers DISABLED
}

// --- Drag & Drop Handlers ---
let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    console.log(`[DragStart] id: ${this.dataset.id}, fromIndex: ${this.dataset.index}, isOld: ${this.dataset.isOld}`);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    this.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDragEnd(e) {
    console.log(`[DragEnd] id: ${this.dataset.id}`);
    this.classList.remove('dragging');
    document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
    draggedItem = null;
}

function handleDrop(targetIsOld, toIndex) {
    // Disabled per user request
    return;
}

// --- Actions ---
function selectDate(date) {
    state.isAllTasksView = false;
    document.getElementById('all-tasks-btn').classList.remove('active');
    state.selectedDate = date;
    renderTimeline();
    renderCalendar();
    loadTodos();
}

function toggleSidebar() {
    state.isSidebarCollapsed = !state.isSidebarCollapsed;
    sidebar.classList.toggle('collapsed');
}

function toggleFullscreen() {
    state.isFullscreen = !state.isFullscreen;
    editorPane.classList.toggle('fullscreen');
    fullscreenBtn.textContent = state.isFullscreen ? '❐' : '⛶';
}

async function handleExport() {
    try {
        const res = await fetch(`/api/export?date=${state.selectedDate}`);
        const data = await res.json();

        let text = `# Weekly Summary (${dayjs(state.selectedDate).startOf('isoWeek').format('YYYY-MM-DD')} to ${dayjs(state.selectedDate).endOf('isoWeek').format('YYYY-MM-DD')})\n\n`;

        const sortedDates = Object.keys(data).sort();
        sortedDates.forEach(date => {
            const dayTodos = data[date].todos;
            if (dayTodos.length > 0) {
                text += `## ${date} (${dayjs(date).format('ddd')})\n`;
                dayTodos.forEach(t => {
                    const status = t.completed ? '[x]' : '[ ]';
                    text += `${status} ${t.title || 'Untitled'}\n`;
                    if (t.content) {
                        const cleanContent = t.content.replace(/<[^>]*>/g, '').trim();
                        if (cleanContent) {
                            text += `   > ${cleanContent.substring(0, 200)}${cleanContent.length > 200 ? '...' : ''}\n`;
                        }
                    }
                });
                text += '\n';
            }
        });

        exportTextarea.value = text;
        exportModal.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        alert('Export failed.');
    }
}

function updateDateTitle() {
    const d = dayjs(state.selectedDate);
    const today = dayjs().format('YYYY-MM-DD');
    if (state.selectedDate === today) {
        dateTitle.textContent = "Today's Todos";
    } else {
        dateTitle.textContent = `${d.format('MMM DD, YYYY')}'s Todos`;
    }
}

function createNewTodo() {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).substring(2);

    const newTodo = {
        id: id,
        title: '',
        content: '',
        completed: false,
        date: state.selectedDate,
        createdAt: dayjs().toISOString()
    };
    state.todos.push(newTodo);
    renderTodoLists();
    openTodo(newTodo);
}

async function openTodo(todo) {
    if (state.selectedTodo && state.selectedTodo.id === todo.id) return;

    // Release previous lock if any
    if (state.selectedTodo) {
        releaseLock(state.selectedTodo.id);
    }

    state.selectedTodo = todo;
    editorPane.classList.remove('hidden-right');
    editorPane.classList.remove('hidden'); // Show resizer
    editorPane.classList.add('mobile-open');
    resizer.classList.remove('hidden');
    editorSection.classList.remove('hidden');
    editorPlaceholder.classList.add('hidden');

    titleInput.value = todo.title || '';
    contentEditor.innerHTML = todo.content || '';
    linkify(contentEditor);

    // Request Lock
    const lockResult = await requestLock(todo.id);
    if (!lockResult.success) {
        toggleReadOnly(true, lockResult.message, lockResult.lockedAt);
    } else {
        toggleReadOnly(false);
        startLockHeartbeat(todo.id);
    }

    updateDrawerBackdrop();
    renderTodoLists();
    updateNoteStats();
}

function toggleReadOnly(readOnly, message = '', lockedAt = null) {
    state.isReadOnly = readOnly;
    titleInput.readOnly = readOnly;
    contentEditor.contentEditable = !readOnly;

    // UI Feedback for Read Only
    const warning = document.getElementById('lock-warning');
    if (readOnly) {
        if (!warning) {
            const warnEl = document.createElement('div');
            warnEl.id = 'lock-warning';
            warnEl.className = 'sync-warning-banner lock-warning';
            warnEl.innerHTML = `
                <span class="lock-msg">🔒 ${message} <span id="lock-duration-text" style="opacity:0.8; font-size:0.8rem; margin-left:4px;"></span></span>
                <button id="retry-lock-btn">Refresh Note</button>
            `;
            document.querySelector('.editor-container').prepend(warnEl);
            document.getElementById('retry-lock-btn').addEventListener('click', refreshCurrentNote);
        }

        // Start duration timer
        if (lockedAt) {
            clearInterval(state.lockDurationInterval);
            const updateDuration = () => {
                const textEl = document.getElementById('lock-duration-text');
                if (textEl) {
                    textEl.textContent = `(${formatDuration(Date.now() - lockedAt)})`;
                }
            };
            updateDuration();
            state.lockDurationInterval = setInterval(updateDuration, 1000);
        }

        // Start auto-unlock check
        startAutoUnlockCheck();
        editorPane.classList.add('read-only-mode');
    } else {
        warning?.remove();
        editorPane.classList.remove('read-only-mode');
        clearInterval(state.lockDurationInterval);
        stopAutoUnlockCheck();
    }
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function startAutoUnlockCheck() {
    stopAutoUnlockCheck();
    state.autoUnlockInterval = setInterval(async () => {
        if (!state.selectedTodo || !state.isReadOnly) {
            stopAutoUnlockCheck();
            return;
        }

        const res = await requestLock(state.selectedTodo.id);
        if (res.success) {
            // Lock acquired! Automatically refresh and unlock
            refreshCurrentNote();
        } else {
            // Still locked. Let's pull the latest content to see progress
            try {
                const date = state.selectedTodo.date || state.selectedDate;
                const getRes = await fetch(`/api/todos?date=${date}`);
                const data = await getRes.json();
                const serverTodo = data.todos?.find(t => t.id === state.selectedTodo.id);

                if (serverTodo && serverTodo.updatedAt > (state.selectedTodo.updatedAt || 0)) {
                    console.log('Progress detected! Updating content...');
                    // Update content silently so we see progress
                    state.selectedTodo = serverTodo;
                    titleInput.value = serverTodo.title || '';
                    contentEditor.innerHTML = serverTodo.content || '';
                    linkify(contentEditor);
                    updateNoteStats();
                }
            } catch (e) { }

            if (res.lockedAt) {
                const textEl = document.getElementById('lock-duration-text');
                if (textEl) {
                    textEl.textContent = `(${formatDuration(Date.now() - res.lockedAt)})`;
                }
            }
        }
    }, 4000); // Check every 4 seconds
}

function stopAutoUnlockCheck() {
    if (state.autoUnlockInterval) {
        clearInterval(state.autoUnlockInterval);
        state.autoUnlockInterval = null;
    }
}

async function requestLock(todoId) {
    try {
        const res = await fetch('/api/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: todoId, sessionId: state.sessionId })
        });
        return await res.json();
    } catch (e) {
        return { success: false, message: 'Could not connect to server.' };
    }
}

async function releaseLock(todoId) {
    stopLockHeartbeat();
    try {
        await fetch('/api/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: todoId, sessionId: state.sessionId })
        });
    } catch (e) { }
}

function startLockHeartbeat(todoId) {
    stopLockHeartbeat();
    state.lockHeartbeatInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/lock/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: todoId, sessionId: state.sessionId })
            });
            const result = await res.json();
            if (!result.success) {
                toggleReadOnly(true, 'Your edit lock expired. Please refresh.');
            } else {
                updateWaitingIndicator(result.someoneWaiting);
            }
        } catch (e) { }
    }, 5000); // Check heartbeat more frequently (5s) for responsiveness
}

function updateWaitingIndicator(show) {
    let indicator = document.getElementById('waiting-indicator');
    const titleHeader = document.querySelector('.title-header');

    if (show) {
        if (!indicator && titleHeader) {
            indicator = document.createElement('span');
            indicator.id = 'waiting-indicator';
            indicator.className = 'waiting-stat title-waiting-stat';
            indicator.title = 'Someone else is waiting to edit this note...';
            indicator.innerHTML = '👤<span class="pulse-dot"></span>';
            titleHeader.appendChild(indicator);
        }
    } else {
        indicator?.remove();
    }
}

function stopLockHeartbeat() {
    if (state.lockHeartbeatInterval) {
        clearInterval(state.lockHeartbeatInterval);
        state.lockHeartbeatInterval = null;
    }
    document.getElementById('waiting-indicator')?.remove();
}

async function refreshCurrentNote() {
    if (!state.selectedTodo) return;

    const btn = document.getElementById('retry-lock-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Refreshing...';

    const id = state.selectedTodo.id;
    const date = state.selectedTodo.date || state.selectedDate;

    try {
        // Minimum delay for animation visibility
        const minWait = new Promise(resolve => setTimeout(resolve, 800));

        const res = await fetch(`/api/todos?date=${date}`);
        const data = await res.json();
        const serverTodo = data.todos?.find(t => t.id === id);

        await minWait;

        if (serverTodo) {
            // Re-open/Refresh the note UI
            state.selectedTodo = serverTodo; // Update local state

            titleInput.value = serverTodo.title || '';
            contentEditor.innerHTML = serverTodo.content || '';
            linkify(contentEditor);
            updateNoteStats();

            // Try to get lock again
            const lockResult = await requestLock(id);
            if (lockResult.success) {
                toggleReadOnly(false);
                startLockHeartbeat(id);
            } else {
                toggleReadOnly(true, lockResult.message);
            }
        }
    } catch (e) {
        console.error('Failed to refresh note:', e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

async function toggleTodoComplete(todo) {
    todo.completed = !todo.completed;

    // 1. 立即更新本地 UI (Optimistic Update)
    renderTodoLists();

    // 2. 在后台异步保存，不阻塞 UI
    saveTodoData(todo).then(() => {
        // 保存后刷新侧边栏统计信息，但不重新加载列表以防闪烁
        fetchHighlightedDates();
        fetchTimelineStats().then(() => renderTimeline());
    });
}

async function deleteCurrentTodo() {
    if (!state.selectedTodo) return;

    const todoId = state.selectedTodo.id;
    const date = state.selectedTodo.date || state.selectedDate;

    // Find index in current list to decide next selection
    const currentIndex = state.todos.findIndex(t => t.id === todoId);
    let nextTodo = null;
    if (state.todos.length > 1) {
        if (currentIndex < state.todos.length - 1) {
            nextTodo = state.todos[currentIndex + 1];
        } else {
            nextTodo = state.todos[currentIndex - 1];
        }
    }

    try {
        await fetch('/api/todos/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, id: todoId })
        });

        if (nextTodo) {
            // If next todo is on the same date, we can just reload and open
            // If it's a search result or something else, it might be different, 
            // but here state.todos is for the current selectedDate.
            await loadTodos();
            openTodo(nextTodo);
        } else {
            closeEditor();
        }

        await fetchHighlightedDates();
        await fetchTimelineStats();
        renderTimeline();
        renderCalendar();
    } catch (e) {
        console.error(e);
    }
}

function autoSave() {
    if (!state.selectedTodo) return;

    state.selectedTodo.title = titleInput.value;
    state.selectedTodo.content = contentEditor.innerHTML;

    updateNoteStats();

    saveTodoData(state.selectedTodo).then(() => {
        const activeItemTitle = document.querySelector(`.todo-item.active .todo-title`);
        if (activeItemTitle) activeItemTitle.textContent = state.selectedTodo.title || '(No Title)';
    });
}

async function manualReloadTodo() {
    if (!state.selectedTodo) return;

    manualReloadBtn.classList.add('spinning');
    try {
        const res = await fetch(`/api/todos?date=${state.selectedDate}`);
        const data = await res.json();
        const updatedTodo = (data.todos || []).find(t => t.id === state.selectedTodo.id);

        if (updatedTodo) {
            state.selectedTodo = updatedTodo;
            titleInput.value = updatedTodo.title || '';
            contentEditor.innerHTML = updatedTodo.content || '';
            updateNoteStats();
            saveStatus.textContent = 'Reloaded';
            setTimeout(() => saveStatus.textContent = 'Saved', 2000);
        }
    } catch (e) {
        console.error(e);
        saveStatus.textContent = 'Reload error';
    } finally {
        setTimeout(() => manualReloadBtn.classList.remove('spinning'), 600);
    }
}

function openSearch() {
    searchOverlay.classList.remove('hidden');
    searchInput.value = '';
    searchResultsList.innerHTML = '<p style="text-align:center; padding:40px; opacity:0.3;">Type to start searching...</p>';
    setTimeout(() => searchInput.focus(), 100);
}

async function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) {
        searchResultsList.innerHTML = '<p style="text-align:center; padding:40px; opacity:0.3;">Type to start searching...</p>';
        return;
    }

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        renderSearchResults(results);
        searchOverlay.classList.remove('hidden');
    } catch (e) { console.error(e); }
}

function renderSearchResults(results) {
    searchResultsList.innerHTML = '';
    if (results.length === 0) {
        searchResultsList.innerHTML = '<p style="text-align:center; padding:20px; opacity:0.5;">No results found.</p>';
        return;
    }

    results.forEach(todo => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
            <div class="search-result-date">${todo.date}</div>
            <div class="search-result-title">${todo.title || '(No Title)'}</div>
            <div class="search-result-snippet">${(todo.content || '').replace(/<[^>]*>/g, '').substring(0, 100)}...</div>
        `;
        item.onclick = () => {
            searchOverlay.classList.add('hidden');
            state.selectedDate = todo.date;
            renderTimeline();
            renderCalendar();
            loadTodos().then(() => {
                openTodo(todo);
            });
        };
        searchResultsList.appendChild(item);
    });
}

function toggleOldTodosCollapse() {
    const list = document.getElementById('old-todos-list');
    const header = document.getElementById('old-todos-header');
    list.classList.toggle('collapsed');
    header.classList.toggle('collapsed-header');
}

async function showAllTasks() {
    try {
        const res = await fetch('/api/todos/all');
        const results = await res.json();

        state.allTodos = results;
        state.isAllTasksView = true;

        // UI updates for active state
        document.getElementById('all-tasks-btn').classList.add('active');
        document.getElementById('sidebar-all-count').textContent = results.length;

        // Remove active from any timeline items
        document.querySelectorAll('.timeline-item').forEach(el => {
            if (el.id !== 'all-tasks-btn') el.classList.remove('active');
        });

        renderTodoLists();

        // Scroll to top
        document.querySelector('.todo-list-content').scrollTop = 0;
    } catch (e) {
        console.error(e);
        alert('Failed to load all tasks.');
    }
}


async function handlePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await uploadAndInsertImage(file);
            }
        }
    }
}

async function uploadAndInsertImage(file) {
    let fileToUpload = file;

    if (state.isCompressionEnabled && file.type.startsWith('image/')) {
        try {
            saveStatus.textContent = 'Compressing...';
            fileToUpload = await compressImage(file);
        } catch (err) {
            console.warn('Compression failed, uploading original.', err);
        }
    }

    const formData = new FormData();
    formData.append('image', fileToUpload);

    try {
        saveStatus.textContent = 'Uploading...';
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        const imgHtml = `<img src="${data.url}" style="max-width: 100%; border-radius: 12px; margin: 15px 0;">`;
        document.execCommand('insertHTML', false, imgHtml);
        autoSave();
    } catch (e) {
        console.error(e);
        saveStatus.textContent = 'Upload failed';
    }
}

async function compressImage(file, quality = 0.7, maxWidth = 1200) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Canvas toBlob failed'));
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                        type: 'image/jpeg',
                        lastModified: Date.now(),
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// --- Resizer ---
function initResizer() {
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.classList.add('resizing');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const width = window.innerWidth - e.clientX;
        if (width > 300 && width < window.innerWidth * 0.95) {
            editorPane.style.width = `${width}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.classList.remove('resizing');
    });
}

// --- Helpers ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function toggleTheme() {
    state.isDarkMode = !state.isDarkMode;
    document.body.className = state.isDarkMode ? 'dark-mode' : 'light-mode';
    localStorage.setItem('theme', state.isDarkMode ? 'dark' : 'light');
}

function checkPrefersColorScheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        state.isDarkMode = true;
        document.body.className = 'dark-mode';
    }
}

function linkify(element) {
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const textNodes = [];
    while (node = walk.nextNode()) {
        if (node.parentNode.tagName !== 'A' && node.parentNode.tagName !== 'SCRIPT' && node.parentNode.tagName !== 'STYLE') {
            textNodes.push(node);
        }
    }

    textNodes.forEach(textNode => {
        const text = textNode.nodeValue;
        const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        if (urlPattern.test(text)) {
            const span = document.createElement('span');
            span.innerHTML = text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
            const parent = textNode.parentNode;
            if (parent) {
                while (span.firstChild) {
                    parent.insertBefore(span.firstChild, textNode);
                }
                parent.removeChild(textNode);
            }
        }
    });
}

// --- Toolbar & Context Actions ---
function updateNoteStats() {
    const text = contentEditor.innerText || "";
    const chars = text.length;
    const picCount = contentEditor.querySelectorAll('img').length;

    const wordCountEl = document.getElementById('note-word-count');
    if (wordCountEl) {
        wordCountEl.textContent = `${chars} chars`;
    }

    const picCountEl = document.getElementById('note-pic-count');
    if (picCountEl) {
        picCountEl.textContent = `${picCount} pics`;
    }

    const noteDate = document.getElementById('note-date');
    if (noteDate && state.selectedTodo) {
        let dateStr = "";
        if (state.selectedTodo.createdAt) {
            dateStr = dayjs(state.selectedTodo.createdAt).format('YYYY-MM-DD HH:mm');
        } else if (state.selectedTodo.date) {
            dateStr = state.selectedTodo.date;
        }
        noteDate.textContent = dateStr || '';
    }
}

function handleToolbarAction(command, value) {
    if (command === 'fontSize') {
        if (value === 'reset') {
            document.execCommand('fontSize', false, "3"); // Default size
        } else {
            const current = document.queryCommandValue('fontSize') || "3";
            let newSize = parseInt(current);
            if (value === 'increase' && newSize < 7) newSize++;
            if (value === 'decrease' && newSize > 1) newSize--;
            document.execCommand('fontSize', false, newSize);
        }
    } else if (command === 'foreColor' && value === 'clear') {
        document.execCommand('removeFormat', false, null);
    } else {
        document.execCommand(command, false, value);
    }
    contentEditor.focus();
}

async function copyAsHtml() {
    const copyBtn = document.getElementById('copy-html-btn');
    const originalText = copyBtn.textContent;
    if (copyBtn.disabled || copyBtn.textContent.includes('Loading')) return;

    try {
        copyBtn.textContent = '⏱ Loading...';

        // Clone the content to manipulate it
        const clone = contentEditor.cloneNode(true);
        const images = clone.querySelectorAll('img');

        // Replace all local images with base64 for embedding in Word/Email
        for (const img of images) {
            try {
                const response = await fetch(img.src);
                const blob = await response.blob();
                const reader = new FileReader();
                const base64 = await new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
                img.src = base64;
                // Add some styling for display in Word
                img.style.maxWidth = '100%';
                img.style.display = 'block';
                img.style.margin = '10px 0';
            } catch (err) {
                console.error('Failed to embed image:', err);
            }
        }

        const html = clone.innerHTML;
        const text = clone.innerText;

        // Use modern Clipboard API to write both HTML and Text
        const type = "text/html";
        const blob = new Blob([html], { type });
        const data = [new ClipboardItem({
            [type]: blob,
            ["text/plain"]: new Blob([text], { type: "text/plain" })
        })];

        await navigator.clipboard.write(data);
        copyBtn.textContent = '✅ Copied!';
    } catch (err) {
        console.error('Failed to copy HTML:', err);
        const htmlContent = contentEditor.innerHTML;
        const fallbackModal = document.getElementById('copy-fallback-modal');
        const fallbackTextarea = document.getElementById('copy-fallback-textarea');

        fallbackModal.classList.remove('hidden');
        fallbackTextarea.value = htmlContent;
    } finally {
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }
}


// --- Lightbox & Image Gallery ---
function openLightbox(index) {
    if (index < 0 || index >= state.activeNoteImages.length) return;
    state.currentLightboxIndex = index;

    const src = state.activeNoteImages[index];
    lightboxImg.src = src;

    // Display index / total
    lightboxCaption.textContent = `${index + 1} / ${state.activeNoteImages.length}`;

    // Get and display dimensions & size
    const infoEl = document.getElementById('lightbox-info');
    if (infoEl) {
        infoEl.textContent = 'Loading info...';

        // Fetch dimensions
        const tempImg = new Image();
        tempImg.onload = async () => {
            const dims = `${tempImg.naturalWidth} × ${tempImg.naturalHeight} px`;
            let sizeStr = "";

            try {
                // Fetch file size via HEAD request (or GET if HEAD is blocked/not yielding length)
                const res = await fetch(src, { method: 'HEAD' });
                let size = res.headers.get('content-length');

                if (!size) {
                    const fullRes = await fetch(src);
                    const blob = await fullRes.blob();
                    size = blob.size;
                }

                if (size) {
                    const kb = (size / 1024).toFixed(1);
                    sizeStr = ` • ${kb} KB`;
                }
            } catch (err) {
                console.warn('Failed to fetch image size:', err);
            }

            infoEl.textContent = dims + sizeStr;
        };
        tempImg.src = src;
    }

    lightboxModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeLightbox() {
    lightboxModal.classList.add('hidden');
    document.body.style.overflow = '';
}

function nextLightboxImage() {
    if (state.activeNoteImages.length <= 1) return;
    let nextIdx = state.currentLightboxIndex + 1;
    if (nextIdx >= state.activeNoteImages.length) nextIdx = 0;
    openLightbox(nextIdx);
}

function prevLightboxImage() {
    if (state.activeNoteImages.length <= 1) return;
    let prevIdx = state.currentLightboxIndex - 1;
    if (prevIdx < 0) prevIdx = state.activeNoteImages.length - 1;
    openLightbox(prevIdx);
}


function openImageList() {
    const allImgs = Array.from(contentEditor.querySelectorAll('img')).map(img => img.src);
    state.activeNoteImages = allImgs;

    imageGrid.innerHTML = '';

    if (allImgs.length === 0) {
        imageGrid.innerHTML = '<p style="padding: 20px; opacity: 0.5;">No images in this note.</p>';
    } else {
        allImgs.forEach((src, index) => {
            const item = document.createElement('div');
            item.className = 'grid-image-item';
            item.innerHTML = `<img src="${src}" alt="Note image ${index + 1}">`;
            item.onclick = () => {
                imageListModal.classList.add('hidden');
                openLightbox(index);
            };
            imageGrid.appendChild(item);
        });
    }

    imageListModal.classList.remove('hidden');
}

// --- Image Resizing Logic ---
let activeResizingImg = null;
let resizeHandle = null;

function setupImageResizing() {
    if (!resizeHandle) {
        resizeHandle = document.createElement('div');
        resizeHandle.className = 'img-resize-handle';
        document.body.appendChild(resizeHandle);
    }

    contentEditor.addEventListener('mouseover', (e) => {
        if (e.target.tagName === 'IMG' && !activeResizingImg) positionHandle(e.target);
    });

    contentEditor.addEventListener('mousemove', (e) => {
        if (e.target.tagName === 'IMG' && !activeResizingImg) positionHandle(e.target);
    });

    window.addEventListener('mouseover', (e) => {
        if (e.target.tagName !== 'IMG' && e.target !== resizeHandle && !activeResizingImg) {
            resizeHandle.style.display = 'none';
        }
    });

    function positionHandle(img) {
        const rect = img.getBoundingClientRect();
        resizeHandle.style.display = 'block';
        resizeHandle.style.left = `${rect.right + window.scrollX - 7}px`;
        resizeHandle.style.top = `${rect.bottom + window.scrollY - 7}px`;
        resizeHandle.targetImg = img;
    }

    let startX, startWidth;
    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeResizingImg = resizeHandle.targetImg;
        startX = e.clientX;
        startWidth = activeResizingImg.clientWidth;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });

    function handleMouseMove(e) {
        if (!activeResizingImg) return;
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth > 30) {
            activeResizingImg.style.width = `${newWidth}px`;
            activeResizingImg.style.height = 'auto';
            positionHandle(activeResizingImg);
        }
    }

    function handleMouseUp() {
        if (activeResizingImg) {
            autoSave();
            activeResizingImg = null;
        }
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }
}

function createLink() {
    const url = prompt("Enter the URL (e.g., https://example.com):");
    if (url) {
        document.execCommand('createLink', false, url.startsWith('http') ? url : 'https://' + url);
        // Ensure link opens in new tab
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const container = selection.getRangeAt(0).commonAncestorContainer;
            const parent = container.nodeType === 3 ? container.parentNode : container;
            const link = parent.closest('a');
            if (link) link.target = "_blank";
        }
    }
}

// Start
init();
