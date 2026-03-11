import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid'; // Need to install uuid
import {
    getTodosForDate,
    saveTodo,
    updateTodosOrder,
    getOldUnfinishedTodos,
    getFutureTodos,
    getAllDatesWithTodos,
    searchTodos,
    getStatsForDates,
    getWeeklyData,
    deleteTodo,
    getAllTodos
} from './data-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

function parseCliArgs(argv) {
    const args = {
        port: process.env.PORT,
        iconPath: process.env.TODO_ICON,
        title: process.env.TODO_TITLE
    };

    for (let i = 0; i < argv.length; i += 1) {
        const current = argv[i];
        const next = argv[i + 1];

        if (current === '--port' || current === '-p') {
            args.port = next;
            i += 1;
            continue;
        }
        if (current.startsWith('--port=')) {
            args.port = current.split('=')[1];
            continue;
        }

        if (current === '--icon' || current === '-i') {
            args.iconPath = next;
            i += 1;
            continue;
        }
        if (current.startsWith('--icon=')) {
            args.iconPath = current.split('=')[1];
            continue;
        }

        if (current === '--title' || current === '-t') {
            args.title = next;
            i += 1;
            continue;
        }
        if (current.startsWith('--title=')) {
            args.title = current.split('=')[1];
            continue;
        }
    }

    return args;
}

function resolveIconPath(iconPathFromArgs) {
    const defaultIcon = path.join(projectRoot, 'public', 'icon.png');
    if (!iconPathFromArgs) return defaultIcon;

    const resolved = path.resolve(process.cwd(), iconPathFromArgs);
    if (!fs.existsSync(resolved)) {
        console.warn(`[icon] file not found: ${resolved}. Fallback to default public/icon.png`);
        return defaultIcon;
    }
    return resolved;
}

const cli = parseCliArgs(process.argv.slice(2));
const app = express();
const parsedPort = Number(cli.port);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const iconPath = resolveIconPath(cli.iconPath);
const appTitle = cli.title?.trim() || 'RB Todo - Minimalist Productivity';
const appShortTitle = appTitle.length > 30 ? appTitle.slice(0, 30).trim() : appTitle;

// Middleware
app.use(express.json());
app.get('/icon.png', (req, res) => {
    res.sendFile(iconPath);
});
app.get('/api/app-config', (req, res) => {
    res.json({
        title: appTitle,
        shortTitle: appShortTitle
    });
});
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Multer for uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
    }
});
const upload = multer({ storage });

// --- Edit Lock System ---
const activeLocks = new Map(); // todoId -> { sessionId, updatedAt, lockedAt, lastWaiterAt }
const LOCK_TIMEOUT = 20000; // 20 seconds

// Cleanup expired locks periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, lock] of activeLocks.entries()) {
        if (now - lock.updatedAt > LOCK_TIMEOUT) {
            activeLocks.delete(id);
        }
    }
}, 10000);

// API Endpoints
app.post('/api/lock', (req, res) => {
    if (!req.body) return res.status(400).json({ success: false, message: 'Missing body' });
    const { id, sessionId } = req.body;
    if (!id || !sessionId) return res.status(400).json({ success: false, message: 'Missing id or sessionId' });

    const now = Date.now();
    const currentLock = activeLocks.get(id);

    if (currentLock && currentLock.sessionId !== sessionId) {
        // Already locked by someone else - Record that someone is waiting
        currentLock.lastWaiterAt = now;
        return res.json({
            success: false,
            message: 'Someone else is editing this note right now.',
            lockedAt: currentLock.lockedAt
        });
    }

    activeLocks.set(id, {
        sessionId,
        updatedAt: now,
        lockedAt: currentLock ? currentLock.lockedAt : now,
        lastWaiterAt: currentLock ? currentLock.lastWaiterAt : 0
    });
    res.json({ success: true });
});

app.post('/api/unlock', (req, res) => {
    if (!req.body) return res.json({ success: true });
    const { id, sessionId } = req.body;
    const currentLock = activeLocks.get(id);
    if (currentLock && currentLock.sessionId === sessionId) {
        activeLocks.delete(id);
    }
    res.json({ success: true });
});

app.post('/api/lock/heartbeat', (req, res) => {
    if (!req.body) return res.status(400).json({ success: false });
    const { id, sessionId } = req.body;
    const now = Date.now();
    const currentLock = activeLocks.get(id);
    if (currentLock && currentLock.sessionId === sessionId) {
        currentLock.updatedAt = now;
        return res.json({
            success: true,
            someoneWaiting: (now - (currentLock.lastWaiterAt || 0)) < 15000
        });
    }
    res.json({ success: false });
});

app.get('/api/todos/all', async (req, res) => {
    try {
        const results = await getAllTodos();
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/todos', async (req, res) => {
    const { date } = req.query;
    try {
        const data = await getTodosForDate(date);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos', async (req, res) => {
    const { date, todo, expectedUpdatedAt } = req.body;
    try {
        const result = await saveTodo(date, todo, expectedUpdatedAt);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos/order', async (req, res) => {
    const { date, todos } = req.body;
    try {
        await updateTodosOrder(date, todos);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/old-todos', async (req, res) => {
    const { date } = req.query; // current date
    try {
        const oldTodos = await getOldUnfinishedTodos(date);
        res.json(oldTodos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/future-todos', async (req, res) => {
    const { date } = req.query; // current date
    try {
        const futureTodos = await getFutureTodos(date);
        res.json(futureTodos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/todo-dates', async (req, res) => {
    try {
        const dates = await getAllDatesWithTodos();
        res.json(dates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const results = await searchTodos(q);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stats', async (req, res) => {
    const { dates } = req.body;
    try {
        const stats = await getStatsForDates(dates);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/export', async (req, res) => {
    const { date } = req.query;
    try {
        const data = await getWeeklyData(date);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos/delete', async (req, res) => {
    const { date, id } = req.body;
    try {
        await deleteTodo(date, id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    res.json({ url: `/uploads/${req.file.filename}` });
});

app.listen(port, () => {
    console.log(`Todo server running at http://localhost:${port}`);
    if (cli.iconPath) {
        console.log(`Using custom icon: ${iconPath}`);
    }
    if (cli.title) {
        console.log(`Using custom title: ${appTitle}`);
    }
});
