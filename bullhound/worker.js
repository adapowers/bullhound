// Script imports
importScripts('service-worker-utils.js');
importScripts('util-papaparse.js');

const state = { status: 'idle', progress: { page: 0, totalPages: null }, lastExport: null };

// DYNAMIC ICON
// Grayscale by default; full color when a table is detected on the active tab

const iconSizes = [16, 48, 128];
const iconCache = { color: null, gray: null };

const loadIconImageData = async () => {
    if (iconCache.color) return;
    iconCache.color = {};
    iconCache.gray = {};
    for (const size of iconSizes) {
        const resp = await fetch(chrome.runtime.getURL('logo/logo-' + size + '.png'));
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        // Color version
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, size, size);
        iconCache.color[size] = ctx.getImageData(0, 0, size, size);
        // Grayscale version
        const grayData = ctx.getImageData(0, 0, size, size);
        const d = grayData.data;
        for (let i = 0; i < d.length; i += 4) {
            const avg = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            d[i] = d[i + 1] = d[i + 2] = avg;
        }
        iconCache.gray[size] = grayData;
        bmp.close();
    }
};

const setIconState = async (active) => {
    try {
        await loadIconImageData();
        const imageData = active ? iconCache.color : iconCache.gray;
        await chrome.action.setIcon({ imageData });
    } catch (e) {
        log('Icon update failed: ' + e.message);
    }
};

// Start grayscale, then immediately probe the active tab.
// This handles the case where the service worker restarts after going idle.
setIconState(false);
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id,
        { from: 'worker', subj: 'update', type: 'request' },
        resp => {
            if (chrome.runtime.lastError) return;
            setIconState(resp && resp.success);
        });
});

// Reset icon when switching tabs, and probe the new tab for a table
chrome.tabs.onActivated.addListener(info => {
    chrome.tabs.sendMessage(info.tabId,
        { from: 'worker', subj: 'update', type: 'request' },
        resp => {
            if (chrome.runtime.lastError) { setIconState(false); return; }
            setIconState(resp && resp.success);
        });
});

//  This function pings Content for the info it needs to build a CSV,
//  and then builds + serves that CSV. In order, it runs:
//      1. parse() – to turn it from a JSON string back into an object
//      2. convert() – uses PapaParser to turn it from JSON->CSV
//      3. encode() – base64 encodes the CSV for easier browser serving
//      4. Assembles the filename, and attaches the file to the browser
 
const askForFile = () => {
    chrome.tabs.query({ active:true, currentWindow:true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id,
        {   from:'worker', 
            subj:'file',
            type:'request'
        },  data => {
            
                try {
                    if (data.success) {
                    const pageSuffix = data.currentPage ? '-pg' + data.currentPage : '';
                    const parsed = parse(data.file);
                    log('Attempting to download '+slugify(data.prefix)+'-'+dateString()+pageSuffix+'.csv');
                    download(encode(convert(parsed)), data.prefix, pageSuffix);
                    state.lastExport = {
                        success: true,
                        timestamp: Date.now(),
                        exportedRows: parsed.length - 1,
                        currentPage: data.currentPage || null,
                        tableName: data.prefix || null
                    };
                    chrome.runtime.sendMessage({
                        from: 'worker', subj: 'page-export-complete',
                        lastExport: state.lastExport
                    });
                    }
                }
                catch (e) {
                    log('Check logs; the CSV file failed to download.');
                    state.lastExport = {
                        success: false,
                        timestamp: Date.now(),
                        error: 'Download failed: ' + e.message,
                        tableName: data.prefix || null
                    };
                    chrome.runtime.sendMessage({
                        from: 'worker', subj: 'page-export-complete',
                        lastExport: state.lastExport
                    });
                }
            }
    )}
)};

//  When this listener hears Popup bugging it for a CSV,
//  it happily obliges by giving the hardest part to Content.

 chrome.runtime.onMessage.addListener((m,sender,sendResponse) => {
    if  (
            (m.subj === 'file') &&
            (m.type === 'request') &&
            (m.from === 'popup')
        )
        {
            log('Passing along the download request...');
            askForFile();
            return true;
        }
    if (m.subj === 'full-table-start' && m.from === 'popup') {
        state.status = 'running';
        state.progress = { page: 0, totalPages: null };
        chrome.tabs.query({ active: true, currentWindow: true }, tabs =>
            chrome.tabs.sendMessage(tabs[0].id,
                { from: 'worker', subj: 'full-table-request', type: 'request' }));
        return false;
    }
    if (m.subj === 'full-table-progress' && m.from === 'content') {
        state.progress = { page: m.page, totalPages: m.totalPages };
        return false;
    }
    if (m.subj === 'full-table-returning' && m.from === 'content') {
        state.status = 'returning';
        return false;
    }
    if (m.subj === 'full-table-finishing' && m.from === 'content') {
        state.status = 'finishing';
        return false;
    }
    if (m.subj === 'full-table-complete' && m.from === 'content') {
        state.status = 'idle';
        const meta = m.meta || {};
        try {
            log('Received full-table data (' + (m.file ? m.file.length : 0) + ' chars, prefix: ' + m.prefix + ')');
            const parsed = parse(m.file);
            log('Parsed: ' + parsed.length + ' rows');
            const converted = convert(parsed);
            log('Converted to CSV: ' + converted.length + ' chars');
            const encoded = encode(converted);
            log('Encoded to base64: ' + encoded.length + ' chars');
            download(encoded, m.prefix, '-full');
            log('Download triggered');
            state.lastExport = {
                success: true,
                timestamp: Date.now(),
                exportedRows: meta.exportedRows || parsed.length - 1,
                dataChanged: meta.dataChanged || false,
                addedDuringExport: meta.addedDuringExport || 0,
                dupCount: meta.dupCount || 0,
                warning: meta.warning || null,
                tableName: m.prefix || null
            };
        }
        catch(e) {
            log('Full table download failed: ' + e.message);
            state.lastExport = {
                success: false,
                timestamp: Date.now(),
                error: 'Download failed: ' + e.message,
                tableName: m.prefix || null
            };
        }
        return false;
    }
    if (m.subj === 'full-table-cancelled' && m.from === 'content') {
        state.status = 'idle';
        state.lastExport = {
            success: false,
            timestamp: Date.now(),
            warning: 'Export was cancelled',
            tableName: m.prefix || null
        };
        return false;
    }
    if (m.subj === 'cancel' && m.from === 'popup') {
        state.status = 'idle';
        chrome.tabs.query({ active: true, currentWindow: true }, tabs =>
            chrome.tabs.sendMessage(tabs[0].id, { from: 'worker', subj: 'cancel' }));
        return false;
    }
    if (m.subj === 'table-status' && m.from === 'content') {
        setIconState(m.found);
        return false;
    }
    if (m.subj === 'state-query' && m.from === 'popup') {
        sendResponse({ status: state.status, progress: state.progress, lastExport: state.lastExport });
        return true; // async response — keep channel open
    }
        return false;
 })
