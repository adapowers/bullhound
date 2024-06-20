// Imported via `worker.js`

// Prettier logging
const log = function (content) {
    console.log('[Bullhound] ' + content);
}

// Returns MM-DD-YYYY-HH-MM
const dateString = function () {
    let d = new Date();
    return d.getMonth() + '-' + d.getDate() + '-' + d.getFullYear() + '-' + d.getHours() + '-' + d.getMinutes();
}

// Base64 encode
const encode = function (string) {
    return 'data:text/csv;base64,' + btoa(string);
}

// JSON string -> JSON object
const parse = function (string) {
    return JSON.parse(string);
}

// JSON object -> CSV
const convert = function (string) {
    return Papa.unparse(string);
}

// Builds filename with a safe default, then downloads it
const download = function (file, prefix = 'bullhorn-table') {
    let filename = prefix + '-' + dateString() + '.csv';
    chrome.downloads.download({
        url: file,
        filename: filename
    });
}
