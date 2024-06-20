// Script imports
importScripts('service-worker-utils.js');
importScripts('util-papaparse.js');

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
                    log('Attempting to download '+data.prefix+'-'+dateString()+'.csv');                    
                    download(encode(convert(parse(data.file))),data.prefix);
                    }
                } 
                catch (e) {
                    log('Check logs; the CSV file failed to download.');
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
        return true;
 })
