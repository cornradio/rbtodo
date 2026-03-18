import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';

const DEFAULT_PROJECT = 'Default';

function resolveProjectDir(projectName) {
    const safeProject = projectName || DEFAULT_PROJECT;
    return path.resolve('projects', safeProject);
}

// Ensure data directory exists (per project)
export async function ensureStorageDir(projectName) {
    const storageDir = resolveProjectDir(projectName);
    try {
        await fs.mkdir(storageDir, { recursive: true });
        await fs.mkdir(path.join(storageDir, 'data'), { recursive: true });
        await fs.mkdir(path.join(storageDir, 'uploads'), { recursive: true });
    } catch (e) {
        console.error('Error creating storage directories:', e);
    }
    return storageDir;
}

export function getStorageDir(projectName) {
    return resolveProjectDir(projectName);
}

export function getDataDir(projectName) {
    return path.join(resolveProjectDir(projectName), 'data');
}

export function getUploadsDir(projectName) {
    return path.join(resolveProjectDir(projectName), 'uploads');
}

/**
 * NEW STORAGE STRATEGY: One file per Todo
 * Filename: YYYY-MM-DD_[ID].json
 */

function getTodoFilePath(date, id, projectName) {
    return path.join(getDataDir(projectName), `${date}_${id}.json`);
}

/**
 * Atomic write to avoid file corruption
 */
async function atomicWriteJson(filePath, data) {
    const tempPath = filePath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
}

export async function getTodosForDate(date, projectName) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
    } catch (e) {
        return { todos: [] };
    }

    const todos = [];
    for (const file of files) {
        if (file.startsWith(date + '_') && file.endsWith('.json')) {
            try {
                const content = await fs.readFile(path.join(getDataDir(projectName), file), 'utf-8');
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

export async function saveTodo(date, todo, expectedUpdatedAt = null, projectName) {
    const filePath = getTodoFilePath(date, todo.id, projectName);
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

export async function updateTodosOrder(date, todos, projectName) {
    // Update the 'order' field in each individual file
    for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        const filePath = getTodoFilePath(date, todo.id, projectName);
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

export async function getOldUnfinishedTodos(currentDate, projectName) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
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
                const todo = JSON.parse(await fs.readFile(path.join(getDataDir(projectName), file), 'utf-8'));
                if (!todo.completed) {
                    allOldUnfinished.push({ ...todo, date: datePart });
                }
            } catch (e) { }
        }
    }
    return allOldUnfinished;
}

export async function getFutureTodos(currentDate, projectName) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
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
                const todo = JSON.parse(await fs.readFile(path.join(getDataDir(projectName), file), 'utf-8'));
                allFuture.push({ ...todo, date: datePart });
            } catch (e) { }
        }
    }
    return allFuture;
}

export async function getAllDatesWithTodos(projectName) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
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

export async function searchTodos(query, projectName) {
    if (!query) return [];
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
    } catch (e) {
        return [];
    }

    const results = [];
    const q = query.toLowerCase();

    for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;
        const datePart = file.split('_')[0];
        try {
            const todo = JSON.parse(await fs.readFile(path.join(getDataDir(projectName), file), 'utf-8'));
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

export async function getStatsForDates(dates, projectName) {
    const stats = {};
    for (const date of dates) {
        const data = await getTodosForDate(date, projectName);
        const todos = data.todos || [];
        stats[date] = {
            total: todos.length,
            completed: todos.filter(t => t.completed).length
        };
    }
    return stats;
}

export async function getAllTodos(projectName) {
    let files = [];
    try {
        files = await fs.readdir(getDataDir(projectName));
    } catch (e) {
        return [];
    }

    const results = [];
    for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/.test(file)) continue;
        const datePart = file.split('_')[0];
        try {
            const todo = JSON.parse(await fs.readFile(path.join(getDataDir(projectName), file), 'utf-8'));
            results.push({ ...todo, date: datePart });
        } catch (e) { }
    }
    return results;
}

export async function getWeeklyData(startDate, projectName) {
    // Return an object where keys are dates in the week
    const result = {};
    const start = dayjs(startDate).startOf('isoWeek');

    for (let i = 0; i < 7; i++) {
        const currentDate = start.add(i, 'day').format('YYYY-MM-DD');
        const data = await getTodosForDate(currentDate, projectName);
        if (data.todos.length > 0) {
            result[currentDate] = data;
        }
    }
    return result;
}

export async function deleteTodo(date, id, projectName) {
    const filePath = getTodoFilePath(date, id, projectName);
    try {
        await fs.unlink(filePath);
    } catch (e) {
        console.warn(`Attempted to delete non-existent file: ${filePath}`);
    }
}
