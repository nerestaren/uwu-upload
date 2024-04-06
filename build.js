const child_process = require('node:child_process');
const fs = require('fs');
const wr = require('winresourcer');

const exe = 'uwu_upload.exe';

// Bundle node_modules
console.info("Bundling node_modules");
child_process.execSync('npx esbuild index.js --bundle --platform=node --outfile=index_bundle.js');

// Copy node executable
console.info("Copying node executable");
fs.copyFileSync(process.execPath, exe);

// Build SEA
console.info("Building SEA");
child_process.execSync('node --experimental-sea-config sea-config.json');

// Inject SEA into exe
console.info("Injecting SEA (ignore 'warning: The signature seems corrupted!')");
child_process.execSync(`npx postject ${exe} NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);

// Changing icon
console.info("Changing icon");
wr({
    operation: 'Add',
    exeFile: exe,
    resourceType: 'Icongroup',
    resourceName: 'IDR_MAINFRAME',
    lang: 1033,
    resourceFile: 'uwu.ico'
}, function (error) {

    // Cleanup
    console.info("Cleaning up");
    fs.unlinkSync('index_bundle.js');
    fs.unlinkSync('sea-prep.blob');
    
    console.info("Done!");
});