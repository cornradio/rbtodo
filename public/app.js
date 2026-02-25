const state = {
    selectedDate: dayjs().format('YYYY-MM-DD'),
    selectedTodo: null,
    todos: [],
    oldTodos: [],
    highlightedDates: [],
    isDarkMode: false,
    timelineStats: {},
    isFullscreen: false,
    isSidebarCollapsed: false
};

// --- DOM Elements ---
const timelineEl = document.getElementById('timeline');
const calendarEl = document.getElementById('calendar');
const oldTodosEl = document.getElementById('old-todos-list');
const todayTodosEl = document.getElementById('today-todos-list');
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

const toggleSidebarBtn = document.getElementById('toggle-sidebar-persistent');
const fullscreenBtn = document.getElementById('fullscreen-editor');

// --- Initialization ---
async function init() {
    setupEventListeners();
    setupKeyboardShortcuts();
    await fetchHighlightedDates();
    await fetchTimelineStats();
    renderTimeline();
    renderCalendar();
    await loadTodos();
    checkPrefersColorScheme();
    initResizer();
}

function setupEventListeners() {
    document.getElementById('add-todo-btn').addEventListener('click', createNewTodo);
    document.getElementById('close-editor').addEventListener('click', () => {
        editorSection.classList.add('hidden');
        editorPlaceholder.classList.remove('hidden');
        state.selectedTodo = null;
        if (state.isFullscreen) toggleFullscreen();
    });

    titleInput.addEventListener('input', debounce(autoSave, 1000));
    contentEditor.addEventListener('input', debounce(autoSave, 1000));

    // Paste image support
    contentEditor.addEventListener('paste', handlePaste);

    document.getElementById('image-upload').addEventListener('change', handleImageUpload);

    themeToggle.addEventListener('click', toggleTheme);

    // Search
    searchInput.addEventListener('input', debounce(handleSearch, 500));
    closeSearchBtn.addEventListener('click', () => searchOverlay.classList.add('hidden'));
    searchOverlay.addEventListener('click', (e) => {
        if (e.target === searchOverlay) searchOverlay.classList.add('hidden');
    });

    // Sidebar Collapse
    toggleSidebarBtn.addEventListener('click', toggleSidebar);

    // Fullscreen
    fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Export
    exportWeekBtn.addEventListener('click', handleExport);
    closeExportBtn.addEventListener('click', () => exportModal.classList.add('hidden'));
    copyExportBtn.addEventListener('click', () => {
        exportTextarea.select();
        document.execCommand('copy');
        copyExportBtn.textContent = 'Copied!';
        setTimeout(() => copyExportBtn.textContent = 'Copy Text', 2000);
    });
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Ctrl + B: Toggle Sidebar
        if (e.ctrlKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
        // Ctrl + Shift + F: Toggle Fullscreen
        if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'f')) {
            e.preventDefault();
            if (!editorSection.classList.contains('hidden')) {
                toggleFullscreen();
            }
        }
    });
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
    saveStatus.textContent = 'Saving...';
    try {
        await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: todo.date || state.selectedDate,
                todo
            })
        });
        saveStatus.textContent = 'Saved';
        await fetchHighlightedDates();
        await fetchTimelineStats();
        renderTimeline();
        renderCalendar();
    } catch (e) {
        saveStatus.textContent = 'Error';
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
    const now = dayjs(state.selectedDate);
    const startOfMonth = now.startOf('month');
    const endOfMonth = now.endOf('month');
    const startDay = startOfMonth.day();
    const daysInMonth = now.daysInMonth();

    calendarEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.8rem; font-weight:bold;">
            <span>${now.format('MMMM YYYY')}</span>
        </div>
        <div class="calendar-grid">
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
}

function renderTodoLists() {
    renderList(state.oldTodos, oldTodosEl, true);
    renderList(state.todos, todayTodosEl, false);
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
        item.draggable = true;
        item.dataset.id = todo.id;
        item.dataset.index = index;

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

        // Drag & Drop
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', (e) => handleDrop(e, container, isOld));
        item.addEventListener('dragend', handleDragEnd);

        container.appendChild(item);
    });
}

// --- Drag & Drop Handlers ---
let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    draggedItem = null;
}

function handleDrop(e, container, isOld) {
    e.preventDefault();
    if (draggedItem !== this) {
        const items = Array.from(container.children);
        const fromIndex = items.indexOf(draggedItem);
        const toIndex = items.indexOf(this);

        if (fromIndex !== -1 && toIndex !== -1) {
            const list = isOld ? state.oldTodos : state.todos;
            const [reorderedItem] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, reorderedItem);

            renderTodoLists();
            if (!isOld) {
                saveTodosOrder(state.selectedDate, state.todos);
            }
        }
    }
}

// --- Actions ---
function selectDate(date) {
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
        dateTitle.textContent = "TODAY'S TODOS";
    } else {
        dateTitle.textContent = `${d.format('MMM DD, YYYY')}'S TODOS`;
    }
}

function createNewTodo() {
    const newTodo = {
        id: crypto.randomUUID(),
        title: '',
        content: '',
        completed: false,
        date: state.selectedDate
    };
    state.todos.push(newTodo);
    renderTodoLists();
    openTodo(newTodo);
}

function openTodo(todo) {
    state.selectedTodo = todo;
    editorSection.classList.remove('hidden');
    editorPlaceholder.classList.add('hidden');

    titleInput.value = todo.title || '';
    contentEditor.innerHTML = todo.content || '';

    renderTodoLists();
}

async function toggleTodoComplete(todo) {
    todo.completed = !todo.completed;
    await saveTodoData(todo);
    loadTodos();
}

function autoSave() {
    if (!state.selectedTodo) return;

    state.selectedTodo.title = titleInput.value;
    state.selectedTodo.content = contentEditor.innerHTML;

    saveTodoData(state.selectedTodo).then(() => {
        const activeItemTitle = document.querySelector(`.todo-item.active .todo-title`);
        if (activeItemTitle) activeItemTitle.textContent = state.selectedTodo.title || '(No Title)';
    });
}

async function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) {
        searchOverlay.classList.add('hidden');
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
            <div class="search-result-snippet">${todo.content.replace(/<[^>]*>/g, '').substring(0, 100)}...</div>
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

// --- Image Handling ---
async function handlePaste(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let imageFound = false;
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                await uploadAndInsertImage(file);
                imageFound = true;
                break;
            }
        }
    }
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        await uploadAndInsertImage(file);
    }
}

async function uploadAndInsertImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    try {
        saveStatus.textContent = 'Uploading...';
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        const img = document.createElement('img');
        img.src = data.url;
        contentEditor.appendChild(img);
        autoSave();
    } catch (e) {
        console.error(e);
        saveStatus.textContent = 'Upload failed';
    }
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

// Start
init();
