// This script gets injected into any opened page
// whose URL matches the pattern defined in the manifest
// (see "content_script" key).
// Several foreground scripts can be declared
// and injected into the same or different pages.

const log = function(content) {
    console.log('[Bullhound] '+content);
}

log('Successful Content Script injection');


const getCellData = function(cell) {
    if (cell.classList.contains('novo-column-preview')) { return ''; }
    else if (cell.getElementsByTagName('a')[0]) { return cell.getElementsByTagName('a')[0].innerHTML; }
    else if (cell.getElementsByTagName('span')[0]) { return cell.getElementsByTagName('span')[0].innerHTML; }
    else if (cell.getElementsByTagName('label')[0]) { return cell.getElementsByTagName('label')[0].innerHTML; }
    else return '';
}

// Where the majority of the magic happens
const prep = function(frame) {
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
        .call(frame.headers,elem => elem.innerHTML)
        .filter(elem => elem);

    table.rows = frame.rows;
    for (let i = 0; i < table.rows.length; i++) {
        let cells = table.rows[i].getElementsByClassName('novo-data-table-cell');
        table.rows[i].cells = [];
        csv[i+1] = [];
        for (let j = 0; j < cells.length-offset; j++) {
            table.rows[i].cells[j] = getCellData(cells[j+offset]);
            csv[i+1].push(getCellData(cells[j+offset]));
        }

    }

    csv[0] = table.headers;
    
    return csv;
}


// CONTENT
const tryUpdate = () => {
    try {
            let frame = document.querySelector('iframe.active').contentWindow.document;
            return  {   success: true,
                        name: frame.querySelector('novo-title').innerHTML
                    }
        }   
    catch(e) 
        {   return  {   
                        success: false
                    }
    }
}
// CONTENT
const tryFile = () => {
    try {
            let frame = document.querySelector('iframe.active').contentWindow.document;
            // log('Transferred file');
            return  {   success: true,
                        prefix: frame.querySelector('.header-title span').innerHTML,
                        file: JSON.stringify(prep(frame))
                    }
        }
    catch(e)
        {   log('Error transferring file');
            return  {
                        success: false
                    }
    }
}
    
// CONTENT
chrome.runtime.onMessage.addListener((m,sender,sendResponse) => {
    if  (
            (m.subj === 'update') &&
            (m.type === 'request') && 
            (m.from === 'popup')
        ) 
        {   log('Checking the DOM...');
            sendResponse(tryUpdate());
            return true;
        }
    if  (
            (m.subj === 'file') &&
            (m.type === 'request') &&
            (m.from === 'worker')
        )
        {   // log('About to send file');
            sendResponse(tryFile());
            return true;
        }
return true;
 });