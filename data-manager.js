import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';

let storageDir = path.resolve('projects/Default');

// Ensure data directory exists
export async function ensureStorageDir(dir) {
    if (dir) storageDir = dir;
    try {
        await fs.mkdir(storageDir, { recursive: true });
        await fs.mkdir(path.join(storageDir, 'data'), { recursive: true });
        await fs.mkdir(path.join(storageDir, 'uploads'), { recursive: true });
    } catch (e) {
        console.error('Error creating storage directories:', e);
    }
}
await ensureStorageDir();

export function getStorageDir() {
    return storageDir;
}

export function getDataDir() {
    return path.join(storageDir, 'data');
}

export function getUploadsDir() {
    return path.join(storageDir, 'uploads');
}

/**
 * NEW STORAGE STRATEGY: One file per Todo
 * Filename: YYYY-MM-DD_[ID].json
 */

function getTodoFilePath(date, id) {
    return path.join(getDataDir(), `${date}_${id}.json`);
}

/**
 * Atomic write to avoid file corruption
 */
async function atomicWriteJson(filePath, data) {
    const tempPath = filePath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
}

export async function getTodosForDate(date) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return { todos: [] };
    }

    const todos = [];
    for (const file of files) {
        if (file.startsWith(date + '_') && file.endsWith('.json')) {
            try {
                const content = await fs.readFile(path.join(getDataDir(), file), 'utf-8');
                const todo = JSON.parse(content);
                todos.push({ ...todo, date: date });
            } catch (e) {
                console.error(`Error reading todo file ${file}:`, e);
            }
        }
    }
    // We can sort by order here if needed, but the UI usually handles that.
    // Let's sort by createdAt or updatedAt just in case.
    todos.sort((a, b) => (a.order || 0) - (b.order || 0));
    return { todos };
}

export async function saveTodo(date, todo, expectedUpdatedAt = null) {
    const filePath = getTodoFilePath(date, todo.id);
    const now = Date.now();
    let finalTodo = { ...todo, updatedAt: now };

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const serverTodo = JSON.parse(content);

        // Conflict Detection
        if (expectedUpdatedAt && serverTodo.updatedAt && serverTodo.updatedAt > expectedUpdatedAt) {
            if (serverTodo.content !== todo.content || serverTodo.title !== todo.title) {
                // Safe Append Strategy
                finalTodo.content = `${serverTodo.content}\n\n<div class="conflict-divider">======= CONFLICT CONTENT (Someone edited) =======</div>\n\n${todo.content}`;
                if (serverTodo.title !== todo.title) {
                    finalTodo.title = `${serverTodo.title} [CONFLICT]`;
                }
                await atomicWriteJson(filePath, finalTodo);
                return { status: 'conflict_merged', updatedAt: now, mergedContent: finalTodo.content };
            }
        }
    } catch (e) {
        // File doesn't exist yet, normal save
    }

    await atomicWriteJson(filePath, finalTodo);
    return { status: 'saved', updatedAt: now };
}

export async function updateTodosOrder(date, todos) {
    // Update the 'order' field in each individual file
    for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        const filePath = getTodoFilePath(date, todo.id);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const serverTodo = JSON.parse(content);
            serverTodo.order = i;
            await atomicWriteJson(filePath, serverTodo);
        } catch (e) {
            // If file missing (shouldn't happen during order update), just ignore or create
        }
    }
}

export async function getOldUnfinishedTodos(currentDate) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return [];
    }

    const today = dayjs(currentDate).startOf('day');
    const allOldUnfinished = [];

    for (const file of files) {
        // Only match YYYY-MM-DD_ID.json format
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;

        const datePart = file.split('_')[0];
        if (dayjs(datePart).isBefore(today)) {
            try {
                const todo = JSON.parse(await fs.readFile(path.join(getDataDir(), file), 'utf-8'));
                if (!todo.completed) {
                    allOldUnfinished.push({ ...todo, date: datePart });
                }
            } catch (e) { }
        }
    }
    return allOldUnfinished;
}

export async function getFutureTodos(currentDate) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return [];
    }

    const today = dayjs(currentDate).startOf('day');
    const allFuture = [];

    for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;

        const datePart = file.split('_')[0];
        if (dayjs(datePart).isAfter(today)) {
            try {
                const todo = JSON.parse(await fs.readFile(path.join(getDataDir(), file), 'utf-8'));
                allFuture.push({ ...todo, date: datePart });
            } catch (e) { }
        }
    }
    return allFuture;
}

export async function getAllDatesWithTodos() {
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return [];
    }

    const dates = new Set();
    for (const file of files) {
        if (/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) {
            dates.add(file.split('_')[0]);
        }
    }
    return Array.from(dates);
}

export async function searchTodos(query) {
    if (!query) return [];
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return [];
    }

    const results = [];
    const q = query.toLowerCase();

    for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;
        const datePart = file.split('_')[0];
        try {
            const todo = JSON.parse(await fs.readFile(path.join(getDataDir(), file), 'utf-8'));
            if (
                (todo.title && todo.title.toLowerCase().includes(q)) ||
                (todo.content && todo.content.toLowerCase().includes(q))
            ) {
                results.push({ ...todo, date: datePart });
            }
        } catch (e) { }
    }
    return results;
}

export async function getStatsForDates(dates) {
    const stats = {};
    for (const date of dates) {
        const data = await getTodosForDate(date);
        const todos = data.todos || [];
        stats[date] = {
            total: todos.length,
            completed: todos.filter(t => t.completed).length
        };
    }
    return stats;
}

export async function getAllTodos() {
    let files = [];
    try {
        files = await fs.readdir(getDataDir());
    } catch (e) {
        return [];
    }

    const results = [];
    for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;
        const datePart = file.split('_')[0];
        try {
            const todo = JSON.parse(await fs.readFile(path.join(getDataDir(), file), 'utf-8'));
            results.push({ ...todo, date: datePart });
        } catch (e) { }
    }
    return results;
}

export async function getWeeklyData(startDate) {
    // Return an object where keys are dates in the week
    const result = {};
    const start = dayjs(startDate).startOf('isoWeek');

    for (let i = 0; i < 7; i++) {
        const currentDate = start.add(i, 'day').format('YYYY-MM-DD');
        const data = await getTodosForDate(currentDate);
        if (data.todos.length > 0) {
            result[currentDate] = data;
        }
    }
    return result;
}

export async function deleteTodo(date, id) {
    const filePath = getTodoFilePath(date, id);
    try {
        await fs.unlink(filePath);
    } catch (e) {
        console.warn(`Attempted to delete non-existent file: ${filePath}`);
    }
}
