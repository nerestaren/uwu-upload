const fs = require('fs/promises');
const AdmZip = require('adm-zip');
const path = require('path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const rl = readline.createInterface({ input, output });

const logFileName = 'WoWCombatLog.txt';
const SERVER_URL = 'https://uwu-logs.xyz';
const POST_URL = '/upload';
const PROGRESS_URL = '/upload_progress';
const CHUNK_SIZE = 256 * 1024;
const chunk = Buffer.alloc(CHUNK_SIZE);
const HTTP_TIMEOUT = 10000;
const HTTP_PROGRESS_TIMEOUT = 2500;

let started = Date.now();
let current = 0;
let retries = 0;
let chunkN = 0;
let handle;
let file;
let filedata;

let settings;

(async () => {
try {
    await loadSettings();

    try {
        /*const uncompressedPath = path.join(settings.path, logFileName);

        // If file does not exist, throw and abort.
        const fd = await fs.open(uncompressedPath);
        fd.close();

        const compressedFileName = logFileName + '.7z';
        const compressedPath = path.join(settings.path, compressedFileName);
        // Delete already compressed file if already there
        try {
            await fs.unlink(compressedPath);
        } catch (e) {
            if (e.code === 'ENOENT') {
                // cool
            } else {
                throw e;
            }
        }
        // Compress new archive
        console.info("Compressing logs...");
        await new Promise((accept, reject) => {
            _7z.pack(uncompressedPath, compressedPath, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    accept(result);
                }
            });
        });*/
        const uncompressedPath = path.join(settings.path, logFileName);
        const compressedFileName = logFileName + '.zip';
        const compressedPath = path.join(settings.path, compressedFileName);

        // If file does not exist, throw and abort.
        const fd = await fs.open(uncompressedPath);
        fd.close();

        const zip = new AdmZip();
        zip.addLocalFile(uncompressedPath);
        await zip.writeZipPromise(compressedPath);

        // Delete log file
        try {
            await fs.unlink(uncompressedPath);
        } catch (e) {
            if (e.code === 'ENOENT') {
                // cool
            } else {
                throw e;
            }
        }
        // Begin
        handle = await fs.open(compressedPath);
        file = await handle.stat();
        if (file.size < 16384) {
            throw "ERROR: Archive is too small, did you archive correct file?";
        } else if (file.size > 1024**4) {
            throw "ERROR: Archive is too big.\nAre you sure it's the correct file?\nAre you sure you compressed it?";
        }
        
        filedata = JSON.stringify({
            filename: compressedFileName,
            server: settings.gameServer,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        

        sendnewchunk();
    } catch (e) {
        switch (e.code) {
            case 'ENOENT':
                console.error(e);
                await rl.question("Press ENTER to close.");
                rl.close();
                break;
            default:
                console.error(e);
                await rl.question("Press ENTER to close.");
                rl.close();
                break;
        }
    } finally {
        /*if (handle) {
            handle.close();
        }*/
    }
} catch (e) {
    console.error("Run this again.");
    await rl.question("Press ENTER to close.");
    rl.close();
}
})();

async function loadSettings() {
    const filename = 'uwu_settings.json';
    let handle;
    try {
        handle = await fs.open(filename);
        const contents = await handle.readFile();
        settings = JSON.parse(contents);
    } catch (e) {
        switch (e.code) {
            case 'ENOENT':
                console.error("a", handle);
                handle = await fs.open(filename, 'w');
                const DEFAULT = JSON.stringify({
                    path: 'Logs',
                    filename: 'WoWCombatLog.txt',
                    gameServer: 'Warmane',
                }, null, 2);
                console.error(`ERROR: Settings file '${filename}' not found.\nCreating it with default values:\n\n${DEFAULT}\n`);
                handle.writeFile(DEFAULT);
                handle.close();
                throw 'SETTINGS_CREATED';
                break;
        }
    } finally {
        if (handle) {
            handle.close();
        }
    }
}

function readableSize(size) {
    const UNITS = ['B', 'KiB', 'MiB', 'GiB'];
    let i;
    for (i = 0; i < UNITS.length && size > 1024; i++) {
        size /= 1024;
    }
    return size.toFixed() + ' ' + UNITS[i];
}

async function sendnewchunk(retry) {
    // console.log('sendnewchunk', retry);
    if (!retry) {
        chunkN = chunkN + 1;
    }
    await handle.read(chunk, 0, CHUNK_SIZE, current);
    const byteArray = Uint8Array.from(chunk);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        retry();
    }, HTTP_TIMEOUT);
    fetch(SERVER_URL + POST_URL, {
        method: 'POST',
        headers: {
            'X-Chunk': chunkN,
            'X-Date': started
        },
        body: byteArray,
        signal: controller.signal,
    }).then(upload_on_ready).finally(() => {
        clearTimeout(timeoutId);
    });
}

function upload_on_ready(response) {
    // console.log('upload_on_ready');
    if (response.status === 201) return logsProcessingCheck();
    if (response.status !== 200) return retry();
    // console.log('upload_on_ready 200');

    retries = 0;
    current = current + CHUNK_SIZE;
    const fsize = Math.min(file.size, current);
    const percent = Math.round(fsize / file.size * 100);
    const done = fsize / 1024 / 1024;
    const timepassed = Date.now() - started;
    const speed = current / timepassed;
    console.info(`${done.toFixed(1)}MB (${speed.toFixed(1)}KB/s | ${percent}%)`);

    if (current < file.size) return sendnewchunk();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        retry();
    }, HTTP_TIMEOUT);
    fetch(SERVER_URL + POST_URL, {
        method: 'POST',
        headers: {
            'X-Chunk': chunkN,
            'X-Date': started,
            'Content-Type': 'application/json',
        },
        body: filedata,
        signal: controller.signal,
    }).then(upload_on_ready).finally(() => {
        clearTimeout(timeoutId);
    });
}

async function retry() {
    if (retries > 5) {
        console.error("ERROR: Server error!");
        await rl.question("Press ENTER to close.");
        rl.close();
        return;
    }
    retries = retries + 1;
    sendnewchunk(true);
}

function logsProcessingCheck() {
    // console.log('logsProcessingCheck');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        logsProcessingCheck();
    }, HTTP_PROGRESS_TIMEOUT);
    fetch(SERVER_URL + PROGRESS_URL, {
        signal: controller.signal,
    }).then(upload_progress).finally(() => {
        clearTimeout(timeoutId);
    });
}

async function upload_progress(response) {
    // console.log('upload_progress', response.status);
    if (response.status === 500) {
        console.error("ERROR: Server error...");
        await rl.question("Press ENTER to close.");
        rl.close();
        return;
    }
    if (response.status !== 200) {
        console.trace("HERE");
        console.error("ERROR: Aborted!");
        await rl.question("Press ENTER to close.");
        rl.close();
        return;
    }
    // console.log('upload_progress 200');
    // const timeout = setTimeout(logsProcessingCheck, 250);
    
    const res = await response.json();
    const done = res.done == 1;
    if (!done) {
        setTimeout(logsProcessingCheck, 250);
    }
    if (!res.slices) return;

    if (!res.status) {
        console.info("Preparing...");
    } else {
        for (let line of res.status.split("  ")) {
            console.info("" + line);
        }
    }

    for (let slice_name in res.slices) {
        const slice = res.slices[slice_name];
        if (done) {
            console.info(`${slice_name} - ${SERVER_URL}/reports/${slice_name} - ${slice.status}`);
        } else {
            console.info(`${slice_name} - ${slice.status}`);
        }
    }

    if (done) {
        rl.question("Press ENTER to close.").then(() => {rl.close()});
    }
}