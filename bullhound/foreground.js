// This script gets injected into any opened page
// whose URL matches the pattern defined in the manifest
// (see "content_script" key).
// Several foreground scripts can be declared
// and injected into the same or different pages.

const logBuffer = [];
const log = function (content) {
    const entry = new Date().toISOString() + ' ' + content;
    logBuffer.push(entry);
    if (logBuffer.length > 500) logBuffer.shift();
    console.log('[Bullhound] ' + content);
}

log('Successfully injected content script');

// Proactively check for a table once the page is ready, so the
// extension icon can turn color before the popup is ever opened.
const probeForTable = () => {
    const result = tryUpdate();
    chrome.runtime.sendMessage({ from: 'content', subj: 'table-status', found: result.success });
    if (result.success) {
        log('Found table: ' + result.name);
    }
};

const initProbe = () => {
    // Bullhorn is an SPA, so the table may not exist yet even after load.
    // Give Angular time to render before first check.
    setTimeout(probeForTable, 3000);

    // Re-probe when the SPA navigates by watching for novo-title appearing/disappearing
    let lastFound = null;
    new MutationObserver(() => {
        const found = !!document.querySelector('[novo-title]');
        if (found !== lastFound) {
            lastFound = found;
            // Brief delay so Angular finishes rendering the new view
            setTimeout(probeForTable, 1000);
        }
    }).observe(document.body, { childList: true, subtree: true });

    // Periodic heartbeat: re-send table status every 5s so the icon
    // stays correct even if the service worker restarts after going idle.
    setInterval(() => {
        const found = !!document.querySelector('[novo-title]');
        chrome.runtime.sendMessage(
            { from: 'content', subj: 'table-status', found },
            () => { if (chrome.runtime.lastError) { /* worker not ready */ } }
        );
    }, 5000);
};

if (document.readyState === 'complete') {
    initProbe();
} else {
    window.addEventListener('load', initProbe);
}


const getCellData = function (cell) {
    if (cell.classList.contains('novo-column-preview')) { return ''; }
    else if (cell.getElementsByTagName('a')[0]) { return cell.getElementsByTagName('a')[0].innerHTML; }
    else if (cell.getElementsByTagName('span')[0]) { return cell.getElementsByTagName('span')[0].innerHTML; }
    else if (cell.getElementsByTagName('label')[0]) { return cell.getElementsByTagName('label')[0].innerHTML; }
    else return '';
}

// Where the majority of the magic happens
const prep = function (frame) {
    let table = [];
    table.headers = [];
    table.rows = [];
    table.rows.cells = [];
    let csv = [];
    let offset = 0;

    frame.headers = frame.querySelectorAll('label[data-automation-id="novo-data-table-label"]');
    frame.rows = frame.getElementsByTagName('novo-data-table-row');
    offset = [].filter.call(frame.headers, elem => !elem.innerHTML).length;

    table.headers = []
        .map
        .call(frame.headers, elem => elem.innerHTML)
        .filter(elem => elem);

    table.rows = frame.rows;
    for (let i = 0; i < table.rows.length; i++) {
        let cells = table.rows[i].getElementsByClassName('novo-data-table-cell');
        table.rows[i].cells = [];
        csv[i + 1] = [];
        for (let j = 0; j < cells.length - offset; j++) {
            table.rows[i].cells[j] = getCellData(cells[j + offset]);
            csv[i + 1].push(getCellData(cells[j + offset]));
        }

    }

    csv[0] = table.headers;

    return csv;
}


// CONTENT
const tryUpdate = () => {
    try {
        // Newer format: content in page (no iframe), novo-title is an attribute
        let titleEl = document.querySelector('[novo-title]');
        if (titleEl) {
            return {
                success: true,
                name: titleEl.innerHTML,
                currentPage: getCurrentPage()
            }
        }
        // Older format: content in iframe, novo-title is an element
        let frame = document.querySelector('iframe.active').contentWindow.document;
        return {
            success: true,
            name: frame.querySelector('novo-title').innerHTML
        }
    }
    catch (e) {
        return {
            success: false
        }
    }
}
// CONTENT
const tryFile = () => {
    try {
        // Newer format: content in page (no iframe), novo-title is an attribute
        let titleEl = document.querySelector('[novo-title]');
        if (titleEl) {
            return {
                success: true,
                prefix: titleEl.innerHTML,
                currentPage: getCurrentPage(),
                file: JSON.stringify(prep(document))
            }
        }
        // Older format: content in iframe, novo-title is an element
        let frame = document.querySelector('iframe.active').contentWindow.document;
        return {
            success: true,
            prefix: frame.querySelector('.header-title span').innerHTML,
            file: JSON.stringify(prep(frame))
        }
    }
    catch (e) {
        log('Error transferring file');
        return {
            success: false
        }
    }
}


// FULL-TABLE HELPERS

let fullTableActive = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const getCurrentPage = () =>
    parseInt(document.querySelector('ul[data-automation-id="pager"] li.page.active')
        ?.textContent?.trim()) || 0;

const getTotalRows = () =>
    parseInt(document.querySelector('[data-automation-id="novo-data-table-of-total-amount"]')
        ?.textContent?.replace(/[^0-9]/g, '')) || 0;

const getPageSize = () =>
    parseInt(document.querySelector('[data-automation-id="pager-select"] .text-ellipsis')
        ?.textContent?.trim()) || 0;

const isLastPage = () =>
    document.querySelector('[data-automation-id="pager-next"]')
        ?.parentElement?.classList.contains('disabled') ?? true;

// Load detector: waits for the loading mask to appear + disappear, confirms
// the active page number matches, and waits for rows to be in the DOM.
// Waits an additional 2000ms once all conditions are met, giving Angular
// time to finish change detection before we scrape or click again.
const waitForPageLoad = async (expectedPage, timeout = 15000) => {
    const start = Date.now();
    const mask = () => document.querySelector('[data-automation-id="novo-data-table-loading"]');
    const onPage = () => getCurrentPage() === expectedPage;
    const hasRows = () => document.getElementsByTagName('novo-data-table-row').length > 0;
    const ready = () => !mask() && onPage() && hasRows();

    // Brief pause, then wait for mask to appear or page to already be ready
    await sleep(150);
    while (Date.now() - start < timeout) {
        if (mask()) break;
        if (ready()) { await sleep(2000); return true; }
        await sleep(100);
    }
    // Wait for mask gone AND page number correct AND rows present
    while (Date.now() - start < timeout) {
        if (ready()) { await sleep(2000); return true; }
        await sleep(150);
    }
    return false; // timed out
};

const clickNext = () =>
    document.querySelector('[data-automation-id="pager-next"]')?.parentElement?.click();

// Navigate backward by always clicking the lowest visible page number for biggest jumps.
// If skippable is true, respects fullTableActive flag for skip/cancel.
const goToFirstPage = async (skippable = true) => {
    while (getCurrentPage() > 1) {
        if (skippable && !fullTableActive) return; // skip requested
        // Find the lowest page number in the visible pager buttons
        let lowestNum = Infinity;
        let lowestLi = null;
        for (const li of document.querySelectorAll('ul[data-automation-id="pager"] li.page')) {
            const num = parseInt(li.textContent.trim());
            if (!isNaN(num) && num < getCurrentPage() && num < lowestNum) {
                lowestNum = num;
                lowestLi = li;
            }
        }
        if (lowestLi) {
            lowestLi.click();
            await waitForPageLoad(lowestNum);
        } else {
            // Fallback: click previous
            const prevLi = document.querySelector('[data-automation-id="pager-previous"]')?.parentElement;
            if (!prevLi || prevLi.classList.contains('disabled')) break;
            const cur = getCurrentPage();
            prevLi.click();
            await waitForPageLoad(cur - 1);
        }
    }
};

// Tries to open the items-per-page select and pick the target value.
// Uses a broad visibility-based search for options rather than a
// fixed selector, since Novo Elements renders them dynamically into
// context-specific CDK overlays.
// Returns the original page size so callers can restore it later.
// If nothing changed, returns null.
const setItemsPerPage = async (target = 500) => {
    const originalSize = getPageSize();
    log('setItemsPerPage: current=' + originalSize + ', target=' + target);
    if (originalSize >= target) {
        log('setItemsPerPage: already at ' + originalSize + ', no change needed');
        return null;
    }
    const trigger = document.querySelector('[data-automation-id="pager-select"] .novo-select-trigger');
    if (!trigger) { log('setItemsPerPage: no select trigger found'); return null; }
    log('setItemsPerPage: opening select dropdown');
    trigger.click();
    // Find any visible element with a purely numeric label, excluding pager page-buttons
    const findOptions = () => Array.from(document.querySelectorAll(
        'novo-list-item, li, [role="option"], novo-option, [role="listitem"]'
    )).filter(el => {
        const text = el.textContent.trim();
        return /^\d+$/.test(text)
            && !el.closest('[data-automation-id="pager"]') // not a page-number button
            && el.getBoundingClientRect().height > 0;      // visible
    });
    // Wait up to 3s for options to appear
    const start = Date.now();
    let options = [];
    while (Date.now() - start < 3000) {
        options = findOptions();
        if (options.length) break;
        await sleep(100);
    }
    log('setItemsPerPage: found ' + options.length + ' options: [' +
        options.map(o => o.textContent.trim()).join(', ') + ']');
    const opt = options.find(o => parseInt(o.textContent.trim()) >= target)
        || options[options.length - 1];
    if (opt) {
        log('setItemsPerPage: clicking option ' + opt.textContent.trim());
        opt.click();
        await waitForPageLoad(1, 5000);
        const newSize = getPageSize();
        log('setItemsPerPage: page size is now ' + newSize);
        return newSize >= target ? originalSize : null;
    }
    // Close the select if we couldn't find options
    log('setItemsPerPage: no suitable option found, closing dropdown');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return null;
};

// Restore items-per-page to a previously saved value.
const restoreItemsPerPage = async (originalSize) => {
    log('restoreItemsPerPage called: originalSize=' + originalSize + ', currentSize=' + getPageSize());
    if (!originalSize || getPageSize() === originalSize) {
        log('restoreItemsPerPage: no restore needed');
        return;
    }
    log('Restoring items per page from ' + getPageSize() + ' to ' + originalSize);
    const trigger = document.querySelector('[data-automation-id="pager-select"] .novo-select-trigger');
    if (!trigger) { log('restoreItemsPerPage: no trigger element found'); return; }
    log('restoreItemsPerPage: clicking trigger');
    trigger.click();
    const findOptions = () => Array.from(document.querySelectorAll(
        'novo-list-item, li, [role="option"], novo-option, [role="listitem"]'
    )).filter(el => {
        const text = el.textContent.trim();
        return /^\d+$/.test(text)
            && !el.closest('[data-automation-id="pager"]')
            && el.getBoundingClientRect().height > 0;
    });
    const start = Date.now();
    let options = [];
    while (Date.now() - start < 3000) {
        options = findOptions();
        if (options.length) break;
        await sleep(100);
    }
    log('restoreItemsPerPage: found ' + options.length + ' options: [' +
        options.map(o => o.textContent.trim()).join(', ') + ']');
    const opt = options.find(o => parseInt(o.textContent.trim()) === originalSize);
    if (opt) {
        log('restoreItemsPerPage: clicking option ' + opt.textContent.trim());
        opt.click();
        await waitForPageLoad(getCurrentPage(), 5000);
        log('restoreItemsPerPage: done, page size is now ' + getPageSize());
    } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        log('restoreItemsPerPage: could not find option for ' + originalSize);
    }
};

// Deduplicate rows (keeps headers at index 0).
// Returns { data, dupCount } so callers can inspect without side effects.
const deduplicateRows = (data) => {
    if (!data || data.length <= 1) return { data, dupCount: 0 };
    const seen = new Set();
    const deduped = [data[0]]; // headers
    for (let i = 1; i < data.length; i++) {
        const key = JSON.stringify(data[i]);
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(data[i]);
        }
    }
    const dupCount = data.length - deduped.length;
    if (dupCount > 0) log('Found ' + dupCount + ' duplicate rows');
    return { data: deduped, dupCount };
};

// Hide the Bullhorn "are you sure" modal + overlay that appears
// if it thinks we're navigating too fast. Only hides during export.
// Returns a cleanup function that removes the injected style.
const suppressAreYouSureModal = () => {
    const style = document.createElement('style');
    style.id = 'bullhound-suppress-modal';
    style.textContent =
        'are-you-sure-modal, [data-automation-id="are-you-sure-modal"],' +
        '.modal-overlay-backdrop, .aside-overlay-backdrop' +
        '{ display: none !important; }';
    document.head.appendChild(style);
    log('Suppressing are-you-sure modal');
    return () => { style.remove(); log('Restored are-you-sure modal'); };
};

// Main full-table scrape loop. Runs detached (not awaited by the message listener).
const fullTableScrape = async () => {
    fullTableActive = true;
    log('** Full table scrape started *');
    const restoreModal = suppressAreYouSureModal();
    try {
        const titleEl = document.querySelector('[novo-title]');
        const prefix = titleEl?.innerHTML?.trim() || 'bullhorn-table';
        log('Table: ' + prefix);

        const originalPageSize = await setItemsPerPage(500);
        if (originalPageSize) {
            log('Saved original page size: ' + originalPageSize);
        } else if (getPageSize() < 500) {
            log('Could not increase items per page; continuing with ' + getPageSize());
        }

        log('Navigating to first page before scrape...');
        await goToFirstPage(false); // not skippable during setup
        await sleep(300);

        const pageSize = getPageSize();
        const startingTotal = getTotalRows();
        let initialTotal = startingTotal;
        let totalPages = (pageSize > 0 && initialTotal > 0)
            ? Math.ceil(initialTotal / pageSize) : null;
        let dataChanged = false;

        log('Starting forward scrape: pageSize=' + pageSize +
            ', totalRows=' + startingTotal + ', totalPages=' + totalPages +
            ', currentPage=' + getCurrentPage());

        let allData = null;
        let pageNum = 1;

        // FORWARD SCRAPE
        while (fullTableActive) {
            const loaded = await waitForPageLoad(pageNum);
            log('Page ' + pageNum + ': loaded=' + loaded +
                ', rows in DOM=' + document.getElementsByTagName('novo-data-table-row').length);

            // Check if total rows changed (data added/removed during export)
            const currentTotal = getTotalRows();
            if (currentTotal !== initialTotal) {
                log('Total rows changed: ' + initialTotal + ' \u2192 ' + currentTotal);
                dataChanged = true;
                initialTotal = currentTotal;
                totalPages = (pageSize > 0 && currentTotal > 0)
                    ? Math.ceil(currentTotal / pageSize) : null;
            }

            const pageData = prep(document);
            const pageRows = pageData.length - (allData === null ? 1 : 0);
            allData = allData === null ? pageData : allData.concat(pageData.slice(1));
            log('Page ' + pageNum + ': scraped ' + (pageData.length - 1) +
                ' rows, total so far: ' + (allData.length - 1));

            chrome.runtime.sendMessage({
                from: 'content', subj: 'full-table-progress',
                page: pageNum, totalPages
            });

            if (isLastPage()) {
                log('Page ' + pageNum + ' is the last page');
                break;
            }

            clickNext();
            pageNum++;
            await sleep(100); // let Angular register the click before we start polling
        }

        if (!fullTableActive) {
            log('Export cancelled during forward scrape');
            await restoreItemsPerPage(originalPageSize);
            chrome.runtime.sendMessage({ from: 'content', subj: 'full-table-cancelled', prefix });
            return;
        }

        log('Forward scrape complete: ' + (allData ? allData.length - 1 : 0) +
            ' rows across ' + pageNum + ' pages');

        // Navigate back to page 1
        // If data changed, skip is disabled cuz we gotta get a clean final capture
        const skippable = !dataChanged;
        const returnSubj = dataChanged ? 'full-table-finishing' : 'full-table-returning';
        log(dataChanged
            ? 'Data changed during export. Returning to page 1 to get missing rows (skip disabled)...'
            : 'Navigating back to page 1 (skippable)...');
        fullTableActive = true; // re-arm so goToFirstPage can run
        chrome.runtime.sendMessage({ from: 'content', subj: returnSubj });
        await goToFirstPage(skippable);
        log('Back at page ' + getCurrentPage());

        // If data changed, re-scrape page 1 to catch any rows pushed down
        if (dataChanged && getCurrentPage() === 1) {
            await waitForPageLoad(1);
            const freshPage1 = prep(document);
            allData = allData.concat(freshPage1.slice(1));
            log('Re-captured page 1: ' + (freshPage1.length - 1) + ' rows');
        }

        // Restore original items-per-page setting
        await restoreItemsPerPage(originalPageSize);

        // Always count duplicates for integrity reporting.
        // Only actually remove them if data changed (pushed rows between pages).
        const rawRowCount = allData ? allData.length - 1 : 0;
        const { data: dedupedData, dupCount } = deduplicateRows(allData);
        let warning = null;

        if (dataChanged) {
            allData = dedupedData;
            if (dupCount > 0) log('Removed ' + dupCount + ' duplicate rows (data changed during export)');
        } else if (dupCount > 0) {
            // Duplicates found but data didn't change — scrape glitch
            allData = dedupedData;
            warning = dupCount + ' duplicate rows detected and removed (possible scrape glitch)';
            log('WARNING: ' + warning);
        }

        const exportedRows = allData ? allData.length - 1 : 0;

        // Send download
        const fileJson = JSON.stringify(allData);
        log('── Export complete: ' + exportedRows + ' rows, ' +
            fileJson.length + ' chars. Sending to worker... ──');
        chrome.runtime.sendMessage({
            from: 'content', subj: 'full-table-complete',
            prefix, file: fileJson,
            meta: {
                exportedRows,
                rawRowCount,
                dataChanged,
                addedDuringExport: dataChanged ? Math.max(0, initialTotal - startingTotal) : 0,
                dupCount,
                warning
            }
        });
    } catch (e) {
        log('Full table error: ' + e.message);
        chrome.runtime.sendMessage({ from: 'content', subj: 'full-table-cancelled',
            prefix: document.querySelector('[novo-title]')?.innerHTML?.trim() || 'table' });
    } finally {
        fullTableActive = false;
        restoreModal();
    }
};


// CONTENT
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
    if (
        (m.subj === 'update') &&
        (m.type === 'request') &&
        (m.from === 'popup' || m.from === 'worker')
    ) {
        const result = tryUpdate();
        log(result.success ? 'Found table: ' + result.name : 'No table detected');
        sendResponse(result);
        // Also notify worker for icon state
        chrome.runtime.sendMessage({ from: 'content', subj: 'table-status', found: result.success });
        return true;
    }
    if (
        (m.subj === 'file') &&
        (m.type === 'request') &&
        (m.from === 'worker')
    ) {
        sendResponse(tryFile());
        return true;
    }
    if (m.subj === 'full-table-request' && m.from === 'worker') {
        sendResponse({ success: true });
        fullTableScrape(); // detached — runs async without blocking
        return false;
    }
    if (m.subj === 'cancel' && m.from === 'worker') {
        fullTableActive = false;
        sendResponse({ success: true });
        return false;
    }
    if (m.subj === 'get-logs' && m.from === 'popup') {
        sendResponse({ logs: logBuffer.join('\n') });
        return true;
    }
    return false; // no async response for unmatched messages
});
