import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid'; // Need to install uuid
import {
    getTodosForDate,
    saveTodo,
    updateTodosOrder,
    getOldUnfinishedTodos,
    getAllDatesWithTodos,
    searchTodos,
    getStatsForDates,
    getWeeklyData,
    deleteTodo,
    getAllTodos
} from './data-manager.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

// Middleware
app.use(express.json());
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
});
