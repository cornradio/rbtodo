import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
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
    getAllTodos,
    ensureStorageDir,
    getUploadsDir
} from './data-manager.js';

const PROJECT_CONFIG_PATH = path.resolve('projects/projects.json');
let currentProject = 'Default';
const sessionProjects = new Map();

async function saveProjectConfig() {
    try {
        await fs.promises.mkdir(path.dirname(PROJECT_CONFIG_PATH), { recursive: true });
        await fs.promises.writeFile(PROJECT_CONFIG_PATH, JSON.stringify({ currentProject }, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save project config:', e);
    }
}

async function loadProjectConfig() {
    try {
        const data = JSON.parse(await fs.promises.readFile(PROJECT_CONFIG_PATH, 'utf-8'));
        currentProject = data.currentProject || 'Default';
    } catch (e) {}
    await ensureStorageDir(currentProject);
}
await loadProjectConfig();

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

function getSessionId(req) {
    return req.headers['x-session-id'] || req.query.sessionId || req.body?.sessionId || null;
}

function getProjectFromReq(req) {
    const explicit = req.query.project || req.body?.project || req.headers['x-project'];
    if (explicit && /^[a-zA-Z0-9_-]+$/.test(explicit)) return explicit;

    const sessionId = getSessionId(req);
    if (sessionId && sessionProjects.has(sessionId)) {
        return sessionProjects.get(sessionId);
    }
    return currentProject;
}

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
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
app.use('/uploads', async (req, res) => {
    const project = getProjectFromReq(req);
    await ensureStorageDir(project);
    const safeName = path.basename(decodeURIComponent(req.path));
    const filePath = path.join(getUploadsDir(project), safeName);
    res.sendFile(filePath, (err) => {
        if (err) res.status(404).end();
    });
});

// Multer for uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const project = getProjectFromReq(req);
            await ensureStorageDir(project);
            cb(null, getUploadsDir(project) + '/');
        } catch (e) {
            cb(e);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
    }
});
const upload = multer({ storage });

// --- Edit Lock System ---
const activeLocksByProject = new Map(); // project -> Map(todoId -> lock)
const LOCK_TIMEOUT = 20000; // 20 seconds

function getLockMap(project) {
    if (!activeLocksByProject.has(project)) {
        activeLocksByProject.set(project, new Map());
    }
    return activeLocksByProject.get(project);
}

// Cleanup expired locks periodically
setInterval(() => {
    const now = Date.now();
    for (const lockMap of activeLocksByProject.values()) {
        for (const [id, lock] of lockMap.entries()) {
            if (now - lock.updatedAt > LOCK_TIMEOUT) {
                lockMap.delete(id);
            }
        }
    }
}, 10000);

// API Endpoints
app.post('/api/lock', (req, res) => {
    if (!req.body) return res.status(400).json({ success: false, message: 'Missing body' });
    const { id, sessionId } = req.body;
    if (!id || !sessionId) return res.status(400).json({ success: false, message: 'Missing id or sessionId' });

    const project = getProjectFromReq(req);
    const activeLocks = getLockMap(project);
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
    const project = getProjectFromReq(req);
    const activeLocks = getLockMap(project);
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
    const project = getProjectFromReq(req);
    const activeLocks = getLockMap(project);
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
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const results = await getAllTodos(project);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/todos', async (req, res) => {
    const { date } = req.query;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const data = await getTodosForDate(date, project);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos', async (req, res) => {
    const { date, todo, expectedUpdatedAt } = req.body;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const result = await saveTodo(date, todo, expectedUpdatedAt, project);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos/order', async (req, res) => {
    const { date, todos } = req.body;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        await updateTodosOrder(date, todos, project);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/old-todos', async (req, res) => {
    const { date } = req.query; // current date
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const oldTodos = await getOldUnfinishedTodos(date, project);
        res.json(oldTodos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/future-todos', async (req, res) => {
    const { date } = req.query;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const futureTodos = await getFutureTodos(date, project);
        res.json(futureTodos);
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
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const dates = await getAllDatesWithTodos(project);
        res.json(dates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const results = await searchTodos(q, project);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stats', async (req, res) => {
    const { dates } = req.body;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const stats = await getStatsForDates(dates, project);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/export', async (req, res) => {
    const { date } = req.query;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        const data = await getWeeklyData(date, project);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/todos/delete', async (req, res) => {
    const { date, id } = req.body;
    try {
        const project = getProjectFromReq(req);
        await ensureStorageDir(project);
        await deleteTodo(date, id, project);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const project = getProjectFromReq(req);
    const encodedProject = encodeURIComponent(project || 'Default');
    res.json({ url: `/uploads/${req.file.filename}?project=${encodedProject}` });
});

// --- Project Management ---
app.get('/api/projects', async (req, res) => {
    try {
        const projectsDir = path.resolve('projects');
        const entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
        const projects = entries
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort();
        const project = getProjectFromReq(req);
        res.json({ projects, currentProject: project });
    } catch (e) {
        res.json({ projects: ['Default'], currentProject });
    }
});

app.post('/api/projects/switch', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name required' });

    const sessionId = getSessionId(req);
    if (sessionId) {
        sessionProjects.set(sessionId, name);
        await ensureStorageDir(name);
        res.json({ success: true, currentProject: name });
        return;
    }

    currentProject = name;
    await ensureStorageDir(currentProject);
    await saveProjectConfig();
    res.json({ success: true, currentProject });
});

app.post('/api/projects/create', async (req, res) => {
    const { name } = req.body;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid project name' });
    }

    const newDir = path.resolve(`projects/${name}`);
    if (fs.existsSync(newDir)) return res.status(400).json({ error: 'Project already exists' });
    await ensureStorageDir(name);
    res.json({ success: true, name });
});

app.delete('/api/projects/:name', async (req, res) => {
    const { name } = req.params;
    if (name === 'Default') return res.status(400).json({ error: 'Cannot delete Default project' });
    if (name === currentProject) return res.status(400).json({ error: 'Cannot delete active project' });
    for (const project of sessionProjects.values()) {
        if (project === name) return res.status(400).json({ error: 'Cannot delete active project' });
    }
    
    const projectDir = path.resolve(`projects/${name}`);
    try {
        await fs.promises.rm(projectDir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/projects/rename', async (req, res) => {
    const { oldName, newName } = req.body;
    if (!newName || !/^[a-zA-Z0-9_-]+$/.test(newName)) {
        return res.status(400).json({ error: 'Invalid new project name' });
    }
    if (oldName === 'Default') return res.status(400).json({ error: 'Cannot rename Default project' });

    const oldDir = path.resolve(`projects/${oldName}`);
    const newDir = path.resolve(`projects/${newName}`);

    if (fs.existsSync(newDir)) {
        return res.status(400).json({ error: 'New project name already exists' });
    }

    try {
        await fs.promises.rename(oldDir, newDir);
        if (currentProject === oldName) {
            currentProject = newName;
            await saveProjectConfig();
        }
        for (const [sessionId, project] of sessionProjects.entries()) {
            if (project === oldName) sessionProjects.set(sessionId, newName);
        }
        res.json({ success: true, name: newName });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/projects/:name/export', async (req, res) => {
    const { name } = req.params;
    const projectDir = path.resolve(`projects/${name}`);
    if (!fs.existsSync(projectDir)) return res.status(404).send('Project not found');

    try {
        const zip = new AdmZip();
        zip.addLocalFolder(projectDir);
        const buffer = zip.toBuffer();
        
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=${name}.rbproject.zip`);
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/projects/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Zip file required' });
    
    // Original filename minus .rbproject.zip
    let projectName = req.file.originalname.replace(/\.rbproject\.zip$|\.zip$/i, '');
    projectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    const projectDir = path.resolve(`projects/${projectName}`);
    
    // If exists, append random suffix
    let finalPath = projectDir;
    let finalName = projectName;
    if (fs.existsSync(projectDir)) {
        finalName = `${projectName}_${Date.now()}`;
        finalPath = path.resolve(`projects/${finalName}`);
    }

    try {
        const zip = new AdmZip(req.file.path);
        zip.extractAllTo(finalPath, true);
        
        // Cleanup temp upload
        await fs.promises.unlink(req.file.path);
        
        res.json({ success: true, name: finalName });
    } catch (e) {
        if (fs.existsSync(req.file.path)) await fs.promises.unlink(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

const PORT = port;
app.listen(PORT, () => {
    console.log(`Todo server running at http://localhost:${PORT}`);
    console.log(`Current project: ${currentProject}`);
});
