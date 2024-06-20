# bullhound

A simple CSV exporter for users of BullhornOne CMS.

Automatically detects when an export-compatible table is loaded in the browser, scrapes the DOM for data and downloads it as a CSV file.

## Installation

### Preferred

Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/bullhound/nhgjcfbmfmohpjnkmepoiknmjfpeijha?pli=1).

### Manual

1. Visit the [latest release](https://github.com/adapowers/bullhound/releases/latest).

1. Download the `bullhound-extension.zip` file and move it to the folder you want the extension to live in (such as `Documents`).

1. Unzip the file, which will place a folder called “bullhound” where the .zip file was placed. (You can delete the .zip file now, if you want.)

1. Open Chrome, and go to the **Extensions** page. You can get there quickly by typing into the address bar: `chrome://extensions`

1. Click the toggle in the upper right of the Extensions page that says **Developer mode**. Several buttons will appear at the top of the page.

1. Click the button that says **Load unpacked**.

1. Chrome will ask you to select the folder containing the extension. Point it to the `bullhound` folder you unzipped, **not** the .zip file itself.

That's it! If you don’t see Bullhound (an icon of a dog) in your Chrome extensions bar, then look where the extension icons are and click the dark puzzle piece, then select Bullhound (or click the pin next to it to make if visible all the time).

## Troubleshooting

This plugin might stop working if Bullhorn updates their CMS significantly enough that the extension no longer recognizes the underlying HTML structure of the table, which it uses to scrape data.

That said, until that day, [clearing your cache](http://google.com/search?q=chrome+how+to+clear+cache) seems to fix any issues with the plugin 100% of the time.

## Still having issues?

If you don't have the internal resources to troubleshoot or modify this extension yourself, [email me](mailto:ada@powe.rs?subject=Bullhound) and we can discuss a freelance development arrangement.
