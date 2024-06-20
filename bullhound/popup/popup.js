
// POPUP
const askForUpdate = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id,
            {
                from: 'popup',
                subj: 'update',
                type: 'request'
            }, data => {
                if (data.success) {
                    document.getElementById("status-csv").innerHTML = "Found: " + data.name;
                    document.getElementById("start-csv").style.display = "block";
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
    ) {   // log('About to ask content for update (by content request)');
        askForUpdate();
        return true;
    }
    return true;
});

// POPUP
document.getElementById("start-csv").addEventListener("click", e => {
    e.preventDefault();
    chrome.runtime.sendMessage(
        {
            from: 'popup',
            subj: 'file',
            type: 'request'
        }, data => {
            // log('About to ask worker to get file from content');
        }
    );

});

askForUpdate();