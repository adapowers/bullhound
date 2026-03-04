// Imported via `worker.js`

// Prettier logging
const log = function (content) {
    console.log('[Bullhound] ' + content);
}

// Returns YYYYMMDDHHMM
const dateString = function () {
    let d = new Date();
    let month = (d.getMonth() + 1).toString().padStart(2, '0');
    let day = d.getDate().toString().padStart(2, '0');
    let year = d.getFullYear();
    let hours = d.getHours().toString().padStart(2, '0');
    let minutes = d.getMinutes().toString().padStart(2, '0');
    return year + month + day + hours + minutes;
}

// Base64 encode (UTF-8 safe)
const encode = function (string) {
    const bytes = new TextEncoder().encode(string);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:text/csv;base64,' + btoa(binary);
}

// JSON string -> JSON object
const parse = function (string) {
    return JSON.parse(string);
}

// JSON object -> CSV
const convert = function (string) {
    return Papa.unparse(string);
}

// Turns mixed-case, spaced, underscored strings into filename-safe ones
const slugify = function (str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}

// Builds filename with a safe default, then downloads it
// with a suffix (e.g., '-full' or '-p3') for disambiguation
const download = function (file, prefix = 'bullhorn-table', suffix = '') {
    let filename = slugify(prefix) + '-' + dateString() + suffix + '.csv';
    chrome.downloads.download({
        url: file,
        filename: filename
    });
}
