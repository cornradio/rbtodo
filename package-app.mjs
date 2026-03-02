import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const releaseFolderName = 'rbtodo';
const zipName = 'rbtodo-release.zip';

// Folders and files to exclude from the release
const excludes = [
    'node_modules',
    'data',
    'uploads',
    'dist',              // Old dist folder
    releaseFolderName,   // Current release folder
    '.git',
    '.gitignore',
    'package-app.mjs',   // The script itself
    zipName,             // The output zip
];

const releaseDir = path.join(__dirname, releaseFolderName);

console.log('--- Cleaning Up ---');
[releaseDir, path.join(__dirname, 'dist'), path.join(__dirname, zipName)].forEach(p => {
    if (fs.existsSync(p)) {
        console.log(`Removing: ${path.basename(p)}`);
        fs.rmSync(p, { recursive: true, force: true });
    }
});

console.log('\n--- Packaging rbtodo ---');
fs.mkdirSync(releaseDir);

function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    const baseName = path.basename(src);

    if (excludes.includes(baseName)) return;

    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(child => {
            copyRecursive(path.join(src, child), path.join(dest, child));
        });
    } else {
        fs.copyFileSync(src, dest);
        console.log(`Included: ${path.relative(__dirname, src)}`);
    }
}

// Perform copy
fs.readdirSync(__dirname).forEach(item => {
    copyRecursive(path.join(__dirname, item), path.join(releaseDir, item));
});

console.log(`\n--- Files collected in ${releaseFolderName}/ ---`);

try {
    console.log(`Zipping to ${zipName}...`);
    // Using PowerShell Command to zip.
    // We zip the folder ITSELF so that unzipping results in a folder named 'rbtodo'.
    const psCommand = `powershell -Command "Compress-Archive -Path '${releaseFolderName}' -DestinationPath '${zipName}' -Force"`;
    execSync(psCommand, { stdio: 'inherit' });
    console.log(`\nSuccess! Your package: ${zipName}`);
} catch (error) {
    console.error('\nFailed to create zip file:', error.message);
    console.log('Note: You can still manually zip the "rbtodo" folder.');
}

console.log('\n--- Build Summary ---');
console.log(`1. Release Source: ./${releaseFolderName}/`);
console.log(`2. Release Zip: ./${zipName}`);
console.log('3. Data and node_modules folders were EXCLUDED.');
console.log('4. deploy instructions: Unzip and run "npm install".');
