import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid'; // Need to install uuid
import {
    getTodosForDate,
    saveTodo,
    getOldUnfinishedTodos,
    getAllDatesWithTodos,
    searchTodos,
    getStatsForDates,
    getWeeklyData
} from './data-manager.js';

const app = express();
const port = 3000;

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

// API Endpoints
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
    const { date, todo } = req.body;
    try {
        await saveTodo(date, todo);
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

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    res.json({ url: `/uploads/${req.file.filename}` });
});

app.listen(port, () => {
    console.log(`Todo server running at http://localhost:${port}`);
});
