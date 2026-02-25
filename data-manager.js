import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

const DATA_DIR = path.resolve('data');

export async function getWeeklyFilePath(date) {
    const d = dayjs(date);
    const fileName = `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}.json`;
    return path.join(DATA_DIR, fileName);
}

export async function readWeeklyData(date) {
    const filePath = await getWeeklyFilePath(date);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        return {};
    }
}

export async function writeWeeklyData(date, data) {
    const filePath = await getWeeklyFilePath(date);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getTodosForDate(date) {
    const data = await readWeeklyData(date);
    return data[date] || { todos: [] };
}

export async function saveTodo(date, todo) {
    const data = await readWeeklyData(date);
    if (!data[date]) {
        data[date] = { todos: [] };
    }

    const index = data[date].todos.findIndex(t => t.id === todo.id);
    if (index !== -1) {
        data[date].todos[index] = todo;
    } else {
        data[date].todos.push(todo);
    }

    await writeWeeklyData(date, data);
}

export async function getOldUnfinishedTodos(currentDate) {
    const files = await fs.readdir(DATA_DIR);
    const allOldUnfinished = [];
    const today = dayjs(currentDate);

    // Sort files by name to process in order (roughly)
    files.sort();

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(DATA_DIR, file);
        const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

        for (const date in data) {
            if (dayjs(date).isBefore(today, 'day')) {
                const unfinished = data[date].todos.filter(t => !t.completed);
                if (unfinished.length > 0) {
                    allOldUnfinished.push(...unfinished.map(t => ({ ...t, date })));
                }
            }
        }
    }
    return allOldUnfinished;
}

export async function getAllDatesWithTodos() {
    const files = await fs.readdir(DATA_DIR);
    const dates = new Set();
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(DATA_DIR, file);
        const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        for (const date in data) {
            if (data[date].todos && data[date].todos.length > 0) {
                dates.add(date);
            }
        }
    }
    return Array.from(dates);
}

export async function searchTodos(query) {
    if (!query) return [];
    const files = await fs.readdir(DATA_DIR);
    const results = [];
    const q = query.toLowerCase();

    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf-8'));
        for (const date in data) {
            const todos = data[date].todos;
            for (const todo of todos) {
                if (
                    (todo.title && todo.title.toLowerCase().includes(q)) ||
                    (todo.content && todo.content.toLowerCase().includes(q))
                ) {
                    results.push({ ...todo, date });
                }
            }
        }
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
