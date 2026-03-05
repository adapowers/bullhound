
// UI STATE HELPERS

let exportActive = false; // prevents askForUpdate from overwriting export UI

const timeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return weeks + 'w ago';
    const months = Math.floor(days / 30);
    return months + 'm ago';
};

let resultTimer = null;

const showExportResult = (result) => {
    const el = document.getElementById('export-result');
    if (resultTimer) { clearInterval(resultTimer); resultTimer = null; }
    if (!result) { el.style.display = 'none'; return; }

    const render = () => {
        const ago = timeAgo(result.timestamp);
        const from = result.tableName ? result.tableName : '';
        let title;
        let text;

        if (!result.success) {
            // Cancelled or failed
            if (result.error) {
                title = '! Error';
                text = 'Couldn\u2019t export: ' + result.error + '.';
            } else {
                title = 'Canceled export';
                text = '';
            }
        } else if (result.warning) {
            if (result.dupCount > 0) {
                // Novo scrape glitch: unexpected duplicates
                title = '!!! Data integrity warning !!!';
                text = 'Exported '
                    + result.exportedRows.toLocaleString()
                    + ' rows, but found/removed duplicates even though there shouldn\u2019t have been any. Try again!';
            } else {
                // Other warnings (e.g., datagrid stall)
                title = '! Warning';
                text = result.exportedRows
                    ? 'Exported ' + result.exportedRows.toLocaleString() + ' rows. ' + result.warning
                    : result.warning;
            }
        } else if (result.dataChanged) {
            // Success with new data captured
            title = 'Successful export';
            text = 'Full table \u2022 ' + result.exportedRows.toLocaleString() + ' rows \u2022 '
            + result.addedDuringExport.toLocaleString() + ' added during export';
            if (result.missedRows > 0) {
                text += ' \u2022 ' + result.missedRows.toLocaleString() + ' couldn\u2019t be captured';
            }
        } else if (result.currentPage) {
            // Single page success
            title = 'Successful export';
            text = 'Page ' + result.currentPage + ' • ' + result.exportedRows.toLocaleString() + ' rows';
        } else {
            // Clean full-table success or visible page for datagrid
            title = 'Successful export';
            const pageText = result.isFullTable ? 'Full table' : (result.formatName === 'datagrid' ? 'Loaded rows only' : 'Full table');
            text = pageText + ' • ' + result.exportedRows.toLocaleString() + ' rows';
        }

        const hint = (result.hint && result.success && !result.warning) ? result.hint : '';

        el.innerHTML = `
        <hr/>
        <ul class="result">
            <li class="result-title">${title}</li>
            <li class="result-text">${text}</li>
            ${hint ? `<li class="result-hint">${hint}</li>` : ''}
            <li class="result-meta">${from} • ${ago}</li>
        </ul>
        `;
    };

    el.style.display = 'block';
    el.className = (result.warning || !result.success) ? 'warning' : 'success';
    render();
    // Update relative time every 30s
    resultTimer = setInterval(render, 30000);
};

const showIdle = (fullTableEnabled = true) => {
    exportActive = false;
    document.getElementById('btn-group-csv').style.display = 'flex';
    document.getElementById('confirm-modal').style.display = 'none';
    const fullBtn = document.getElementById('start-csv-full');
    fullBtn.disabled = !fullTableEnabled;
    fullBtn.title = fullTableEnabled ? '' : 'To do a full export, try again from page 1.';
    if (fullTableEnabled) {
        document.getElementById('full-table-status').style.display = 'none';
    } else {
        document.getElementById('full-table-status').style.display = 'block';
        document.getElementById('progress-text').textContent = 'To do a full export, try again from page 1.';
        document.getElementById('cancel-csv').style.display = 'none';
    }
};

const showConfirm = () => {
    document.getElementById('btn-group-csv').style.display = 'none';
    document.getElementById('full-table-status').style.display = 'none';
    document.getElementById('confirm-modal').style.display = 'block';
};

// Common setup for all export-in-progress states
const showExportStatus = (progressText, cancelLabel = 'CANCEL', cancelDisabled = false) => {
    exportActive = true;
    document.getElementById('btn-group-csv').style.display = 'none';
    document.getElementById('full-table-status').style.display = 'block';
    document.getElementById('confirm-modal').style.display = 'none';
    document.getElementById('export-result').style.display = 'none';
    document.getElementById('progress-text').textContent = progressText;
    document.getElementById('cancel-csv').style.display = '';
    document.getElementById('cancel-csv').textContent = cancelLabel;
    document.getElementById('cancel-csv').disabled = cancelDisabled;
};

const showRunning = (page, totalPages, loadedRows) => {
    let text;
    if (loadedRows != null && page == null) {
        // Datagrid: infinite scroll, row-based progress
        text = `Loaded ${loadedRows.toLocaleString()} rows\u2026`;
    } else if (!page) {
        text = 'Starting\u2026 Don\u2019t navigate away.';
    } else if (totalPages) {
        text = `Exported page ${page} of ${totalPages}, loading next\u2026`;
    } else {
        text = `Exported page ${page}\u2026`;
    }
    showExportStatus(text);
};

const showReturning = () =>
    showExportStatus('Navigating back to the first page\u2026', 'SKIP');

const showFinishing = () =>
    showExportStatus('Entries added during export \u2014 going back to get them\u2026', 'SKIP', true);


// POPUP
const askForUpdate = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id,
            {
                from: 'popup',
                subj: 'update',
                type: 'request'
            }, data => {
                if (data && data.success) {
                    document.getElementById("status-csv").innerHTML = "<h3>Table: " + data.name + "</h3>";
                    // Update confirm modal copy if the format provides it
                    if (data.confirmCopy) {
                        document.getElementById('confirm-copy').innerHTML =
                            data.confirmCopy.map(p => '<p>' + p + '</p>').join('');
                    }
                    // Don't overwrite the export UI if an export is in progress
                    if (!exportActive) {
                        const fullTableEnabled = data.supportsFullTable === true
                            && (!data.currentPage || data.currentPage <= 1);
                        showIdle(fullTableEnabled);
                        // Show last export result (only when a table is present)
                        chrome.runtime.sendMessage({ from: 'popup', subj: 'state-query' }, state => {
                            if (state && state.lastExport) showExportResult(state.lastExport);
                        });
                    }
                }
            }
        );
    })
};

// POPUP
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (
        (m.subj === 'update') &&
        (m.type === 'handshake') &&
        (m.from === 'content')
    ) {
        askForUpdate();
        return false;
    }
    if (m.subj === 'full-table-progress' && m.from === 'content') {
        showRunning(m.page, m.totalPages, m.loadedRows);
        return false;
    }
    if (m.subj === 'full-table-returning' && m.from === 'content') {
        showReturning();
        return false;
    }
    if (m.subj === 'full-table-finishing' && m.from === 'content') {
        showFinishing();
        return false;
    }
    if (m.subj === 'full-table-complete' && m.from === 'content') {
        exportActive = false;
        const meta = m.meta || {};
        showExportResult({
            success: true,
            timestamp: Date.now(),
            exportedRows: meta.exportedRows || 0,
            dataChanged: meta.dataChanged || false,
            addedDuringExport: meta.addedDuringExport || 0,
            dupCount: meta.dupCount || 0,
            missedRows: meta.missedRows || 0,
            warning: meta.warning || null,
            hint: meta.hint || null,
            tableName: m.prefix || null,
            formatName: m.formatName || null,
            isFullTable: true
        });
        askForUpdate();
        return false;
    }
    if (m.subj === 'full-table-cancelled' && m.from === 'content') {
        exportActive = false;
        showExportResult({
            success: false,
            timestamp: Date.now(),
            tableName: m.prefix || null
        });
        askForUpdate();
        return false;
    }
    if (m.subj === 'page-export-complete' && m.from === 'worker') {
        showExportResult(m.lastExport);
        return false;
    }
    return false;
});

// POPUP - Current Page button
document.getElementById("start-csv-page").addEventListener("click", e => {
    e.preventDefault();
    chrome.runtime.sendMessage(
        {
            from: 'popup',
            subj: 'file',
            type: 'request'
        }
    );
});

// POPUP - Full Table button → show confirmation first
document.getElementById("start-csv-full").addEventListener("click", e => {
    e.preventDefault();
    showConfirm();
});

// POPUP — Confirm Yes
document.getElementById("confirm-yes").addEventListener("click", e => {
    e.preventDefault();
    showRunning(0, null);
    chrome.runtime.sendMessage({ from: 'popup', subj: 'full-table-start' });
});

// POPUP — Confirm No
document.getElementById("confirm-no").addEventListener("click", e => {
    e.preventDefault();
    askForUpdate();
});

// POPUP — Cancel / Skip button
document.getElementById("cancel-csv").addEventListener("click", e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ from: 'popup', subj: 'cancel' });
    // Instantly show idle (not on page 1, so disable Full Table)
    showIdle(false);
    // Then refine button state from actual DOM
    askForUpdate();
});

// On load: check if an export is already running (handles popup-was-closed case)
chrome.runtime.sendMessage({ from: 'popup', subj: 'state-query' }, data => {
    if (data && data.status === 'running') {
        showRunning(data.progress.page, data.progress.totalPages, data.progress.loadedRows);
    } else if (data && data.status === 'returning') {
        showReturning();
    } else if (data && data.status === 'finishing') {
        showFinishing();
    }
});

// POPUP - Debug link: copy logs to clipboard
document.getElementById("debug-link").addEventListener("click", e => {
    e.preventDefault();
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id,
            { from: 'popup', subj: 'get-logs' },
            data => {
                const logs = (data && data.logs) || '(no logs available)';
                navigator.clipboard.writeText(logs).then(() => {
                    const link = document.getElementById('debug-result');
                    link.textContent = 'Logs copied to clipboard!';
                    setTimeout(() => { link.textContent = ''; }, 2000);
                });
            });
    });
});

askForUpdate();
