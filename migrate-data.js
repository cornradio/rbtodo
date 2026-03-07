import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve('data');

async function migrate() {
    console.log('--- Starting Data Migration ---');
    let files = [];
    try {
        files = await fs.readdir(DATA_DIR);
    } catch (e) {
        console.error('Data directory not found.');
        return;
    }

    let totalMigrated = 0;

    for (const file of files) {
        // Match old weekly format: 2026-W10.json
        if (!/^\d{4}-W\d{2}\.json$/.test(file)) continue;

        const filePath = path.join(DATA_DIR, file);
        console.log(`Processing ${file}...`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            for (const date in data) {
                const section = data[date];
                if (section && Array.isArray(section.todos)) {
                    for (let i = 0; i < section.todos.length; i++) {
                        const todo = section.todos[i];
                        if (!todo || !todo.id) continue;

                        // Ensure order is preserved
                        if (todo.order === undefined) {
                            todo.order = i;
                        }

                        const newFileName = `${date}_${todo.id}.json`;
                        const newFilePath = path.join(DATA_DIR, newFileName);

                        await fs.writeFile(newFilePath, JSON.stringify(todo, null, 2), 'utf-8');
                        totalMigrated++;
                    }
                }
            }
            // Optional: Backup old file or delete it
            await fs.rename(filePath, path.join(DATA_DIR, file + '.bak'));
            console.log(`Finished ${file}. Backed up to ${file}.bak`);
        } catch (e) {
            console.error(`Error migrating ${file}:`, e.message);
        }
    }

    console.log(`--- Migration Complete! Migrated ${totalMigrated} todos. ---`);
    console.log('You can now see individual .json files in your data folder.');
}

migrate();
