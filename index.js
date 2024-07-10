const fs = require('fs/promises');
const AdmZip = require('adm-zip');
const path = require('path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
// Original package has a bug in header resetting, so I had to fix it.
// Using forked repo for now.
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const rl = readline.createInterface({ input, output });

const logFileName = 'WoWCombatLog.txt';
const SERVER_URL = 'https://uwu-logs.xyz';

const POST_URL = '/upload';
const PROGRESS_URL = '/upload_progress';
const CHUNK_SIZE = 256 * 1024;
const SERVER_ERRORS = [400, 500, 507];

const chunk = Buffer.alloc(CHUNK_SIZE);

let HANDLE;
let FILE_STAT;
let FILE_NAME;
let FILE_SIZE;

let settings;

(async () => {
try {
    await loadSettings();

    try {
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
        HANDLE = await fs.open(compressedPath);
        FILE_NAME = compressedFileName;
        FILE_STAT = await HANDLE.stat();
        FILE_SIZE = FILE_STAT.size;
        if (FILE_SIZE < 16*1024) {
            throw "ERROR: Archive is too small, did you archive correct file?";
        } else if (FILE_SIZE > 1024**4) {
            throw "ERROR: Archive is too big.\nAre you sure it's the correct file?\nAre you sure you compressed it?";
        }
        
        const UPLOAD_PROGRESS = new UploadProgress();
        const _callback_on_finish = () => UPLOAD_PROGRESS.get_progress();
        const u = new Upload(_callback_on_finish);
        u.start();

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

async function end() {
    console.log('\nDone.\n');
    await rl.question("Press ENTER to close.");
    rl.close();
}

// -- OUTPUT FUNCTIONS --------------------------------------------------------

function new_status_msg(msg) {
    console.log(msg);
}
function add_parsed_slices(slices) {
    if (!slices) return;
    for (const raid_id in slices) {
        const raid_data = slices[raid_id];
        const row = new_row(raid_id, raid_data);
        console.log(row);
    }
}

function new_row(report_name, report_data) {
    if (report_data.done == 1) {
        return `${report_name} - ${report_data.status} - ${SERVER_URL}/reports/${report_name}`;
    } else {
        return `${report_name} - ${report_data.status}`;
    }
}

// -- PROGRESS ----------------------------------------------------------------

class UploadProgress extends XMLHttpRequest {
    constructor() {
        super();

        this.timeout = 5000;
        this.onload = this.upload_progress;
        this.ontimeout = this.retry;

        this.retries = 0;
        this.shown = false;
    }
    get_progress() {
        this.open("GET", SERVER_URL + PROGRESS_URL);
        this.send();
    }
    show() {
        new_status_msg("Preparing...");
        this.shown = true;
    }
    retry() {
        if (this.retries > 5) {
            console.error("Server error!");
            end();
            return;
        }
        this.retries = this.retries + 1;
        console.log(`retry: ${this.retries}`);
        this.get_progress();
    }
    upload_progress() {
        if (this.status === 404) {
            console.error("upload_progress reset");
            end();
            return;
        }

        this.show();

        if (this.status == 502) {
            console.error("Upload server is offline");
            end();
            return;
        }
        if (SERVER_ERRORS.includes(this.status)) {
            console.error("Server error!");
            end();
            return;
        }
        if (this.status !== 200) return this.retry();

        this.retries = 0;

        const response_json = JSON.parse(this.responseText);
        if (response_json.done != 1) {
            setTimeout(() => this.get_progress(), 250);
        }
        new_status_msg(response_json.status);
        add_parsed_slices(response_json.slices);

        if (response_json.done == 1) {
            end();
        }
    }
}

// -- UPLOAD ------------------------------------------------------------------

class Upload extends XMLHttpRequest {
    constructor(callback_on_finish) {
        super();
        this.timeout = 5000;
        this.ontimeout = this.retry;
        this.onload = this.on_upload_response;

        this.STARTED_TIMESTAMP = Date.now();
        this.FILE = HANDLE;
        this.SIZE = FILE_SIZE;
        this.TOTAL_CHUNKS = Math.ceil(this.SIZE / CHUNK_SIZE);
        this.FILE_DATA = JSON.stringify({
            filename: FILE_NAME,
            server: settings.gameServer,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            chunks: this.TOTAL_CHUNKS,
        });

        this.retries = 0;
        this.current_chunk = 0;

        this.callback_on_finish = callback_on_finish;
    }
    start() {
        //console.debug("New file");
        //console.debug(this.FILE_DATA);

        this.send_new_chunk();
    }
    on_upload_response() {
        if (SERVER_ERRORS.includes(this.status)) return this.upload_error();
        if (this.status === 201) return this.callback_on_finish();
        if (this.status !== 200) return this.retry();

        this.update_upload_bar();
        this.send_new_chunk_wrap();
    }
    async new_file_chunk() {
        const start = this.current_chunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, this.SIZE);
        await this.FILE.read(chunk, 0, end - start, start);
        return Uint8Array.from(chunk).slice(0, end - start); // slice to remove garbage bytes
    }
    async send_new_chunk() {
        this.sent_timestamp = Date.now();
        const bytes = await this.new_file_chunk();
        this.open("POST", SERVER_URL + POST_URL);
        this.setRequestHeader("X-Chunk", this.current_chunk);
        this.setRequestHeader("X-Upload-ID", this.STARTED_TIMESTAMP);
        this.send(bytes);
    }
    send_new_chunk_wrap(is_retry) {
        if (!is_retry) {
            this.retries = 0;
            this.current_chunk = this.current_chunk + 1;
        }

        if (this.current_chunk < this.TOTAL_CHUNKS) {
            this.send_new_chunk();
        } else {
            this.send_file_data_to_finish();
        }
    }
    async send_file_data_to_finish() {
        console.debug(`Done. Total uploaded chunks: ${this.current_chunk}`);
        // Wait so the XMLHR is ended and `sendFlag` is reset.
        await new Promise(resolve => setTimeout(resolve, 500));
        this.open("POST", SERVER_URL + POST_URL);
        this.setRequestHeader("Content-Type", "application/json");
        this.send(this.FILE_DATA);
    }
    retry(e) {
        if (this.retries > 5) {
            new_status_msg(`Server error!  Aborted after ${this.retries} tries.`)
            end();
            return;
        }
        this.retries = this.retries + 1;
        const t = e ? "timeout" : "error";
        console.debug(`Server ${t} ${this.retries} / 5`);
        setTimeout(() => {
            this.send_new_chunk_wrap(true);
        }, 1000);
    }
    upload_error() {
        console.debug('upload error');
        const response_json = JSON.parse(this.responseText);
        console.debug(response_json);
        new_status_msg(response_json.detail);
        end();
    }
    uploaded_bytes() {
        const t = (this.current_chunk + 1) * CHUNK_SIZE;
        return Math.min(this.SIZE, t)
    }
    upload_speed() {
        const time_passed_ms = Date.now() - this.sent_timestamp;
        const time_passed = time_passed_ms / 1000;
        return CHUNK_SIZE / 1024 / time_passed;
    }
    update_upload_bar() {
        const uploaded_bytes = this.uploaded_bytes();
        const uploaded_megabytes = (uploaded_bytes / 1024 / 1024).toFixed(1);
        const percent = (uploaded_bytes / this.SIZE * 100).toFixed(1);
        const speed = this.upload_speed().toFixed(1);

        // readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${uploaded_megabytes}MB (${speed}KB/s | ${percent}%)`);
        process.stdout.write('\n'); // plan to make a single line by removing it
    }
}