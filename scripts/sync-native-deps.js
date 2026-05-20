const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const deps = [
    { name: 'better-sqlite3', relativePath: 'build/Release/better_sqlite3.node' }
];

const target = process.argv[2]; // 'node' or 'electron'

if (!['node', 'electron'].includes(target)) {
    console.error('Usage: node sync-native-deps.js [node|electron]');
    process.exit(1);
}

function getAbi() {
    if (target === 'node') {
        return 'node-abi-' + process.versions.modules;
    } else {
        try {
            // Get electron version from package.json
            const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
            const electronVer = pkg.devDependencies.electron.replace('^', '').replace('~', '');
            return 'electron-v' + electronVer;
        } catch (e) {
            return 'electron-unknown';
        }
    }
}

const abi = getAbi();
console.log(`\x1b[34m[sync-native-deps]\x1b[0m Target: ${target} (${abi})`);

deps.forEach(dep => {
    const depDir = path.join(process.cwd(), 'node_modules', dep.name);
    if (!fs.existsSync(depDir)) {
        console.warn(`\x1b[33m[sync-native-deps]\x1b[0m Dependency ${dep.name} not found in node_modules. Skipping.`);
        return;
    }

    const fullPath = path.join(depDir, dep.relativePath);
    const cacheDir = path.join(process.cwd(), '.native-deps-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

    const cachePath = path.join(cacheDir, `${dep.name}-${abi}.node`);

    // Check if we already have the target ABI in place
    // We can't easily check the ABI of a .node file without loading it,
    // so we rely on a marker file or just swap if the cache exists.
    
    const markerPath = path.join(depDir, '.current-abi');
    const currentAbi = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';

    if (currentAbi === abi && fs.existsSync(fullPath)) {
        console.log(`\x1b[32m[sync-native-deps]\x1b[0m ${dep.name} is already ${abi}.`);
        return;
    }

    if (fs.existsSync(cachePath)) {
        console.log(`\x1b[32m[sync-native-deps]\x1b[0m Restoring ${dep.name} from cache...`);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.copyFileSync(cachePath, fullPath);
        fs.writeFileSync(markerPath, abi);
    } else {
        console.log(`\x1b[33m[sync-native-deps]\x1b[0m Cache miss for ${dep.name} (${abi}). Rebuilding...`);
        try {
            if (target === 'node') {
                console.log(`\x1b[33m[sync-native-deps]\x1b[0m Running node-gyp rebuild for ${dep.name}...`);
                execSync(`cd node_modules/${dep.name} && npx node-gyp rebuild`, { stdio: 'inherit' });
            } else {
                console.log(`\x1b[33m[sync-native-deps]\x1b[0m Running @electron/rebuild for ${dep.name}...`);
                const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
                const electronVer = pkg.devDependencies.electron.replace('^', '').replace('~', '');
                execSync(`npx @electron/rebuild -f -v ${electronVer} -a ${process.arch} -w ${dep.name}`, { stdio: 'inherit' });
            }
            
            // Cache the newly built binary
            if (fs.existsSync(fullPath)) {
                console.log(`\x1b[32m[sync-native-deps]\x1b[0m Caching ${dep.name} for ${abi}...`);
                fs.copyFileSync(fullPath, cachePath);
                fs.writeFileSync(markerPath, abi);
            }
        } catch (err) {
            console.error(`\x1b[31m[sync-native-deps]\x1b[0m Failed to rebuild ${dep.name}:`, err.message);
        }
    }
});
