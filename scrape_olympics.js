const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs').promises;

class WikipediaTable {
    constructor(name, headerRows, tableData, sport, sportSubcategory) {
        this.name = name;
        this.headerRows = headerRows;
        this.tableData = tableData;
        this.sport = sport;
        this.sportSubcategory = sportSubcategory;
    }

    toJSON() {
        return {
            name: this.name,
            headerRows: this.headerRows,
            tableData: this.tableData,
            sport: this.sport,
            sportSubcategory: this.sportSubcategory
        };
    }
}

const countries = [
    'Iran',
    'Denmark',
    'Turkey',
    'New Zealand',
    'Ukraine',
    'Ethiopia',
    'Kenya',
    'Sweden',
    'Belgium',
    'Georgia',
    'Uzbekistan',
    'Switzerland'
];

async function scrapeOlympicTeam(country) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(`https://en.wikipedia.org/wiki/${country}_at_the_2024_Summer_Olympics`, { waitUntil: 'networkidle0' });
    const content = await page.content();
    const $ = cheerio.load(content);

    const allTables = [];
    let currentSport = '';
    let currentSubcategory = '';

    $('h2, dl, table.wikitable').each((index, element) => {
        const $element = $(element);

        if ($element.is('h2')) {
            currentSport = $element.text().trim();
            currentSubcategory = '';
        } else if ($element.is('dl')) {
            currentSubcategory = $element.find('dt').first().text().trim();
        } else if ($element.is('table.wikitable')) {
            const headerRows = [];
            const tableData = [];
            const rowspans = {};

            let tableName = $element.find('caption').text().trim();
            if (!tableName) {
                tableName = currentSubcategory || `${currentSport} Table ${index + 1}`;
            }

            $element.find('tr').each((rowIndex, row) => {
                const $row = $(row);
                const rowData = [];
                let colIndex = 0;

                $row.find('th, td').each((cellIndex, cell) => {
                    const $cell = $(cell);
                    const colspan = parseInt($cell.attr('colspan') || 1, 10);
                    const rowspan = parseInt($cell.attr('rowspan') || 1, 10);
                    const cellContent = $cell.text().trim();

                    // Handle rowspans from previous rows
                    while (rowspans[colIndex]) {
                        rowData.push(rowspans[colIndex].content);
                        rowspans[colIndex].span--;
                        if (rowspans[colIndex].span === 0) {
                            delete rowspans[colIndex];
                        }
                        colIndex++;
                    }

                    // Add the current cell content
                    rowData.push(cellContent);

                    // Handle colspan
                    for (let i = 1; i < colspan; i++) {
                        rowData.push(cellContent);
                    }

                    // Handle rowspan
                    if (rowspan > 1) {
                        for (let i = 1; i < rowspan; i++) {
                            if (!rowspans[colIndex]) {
                                rowspans[colIndex] = { content: cellContent, span: rowspan - 1 };
                            }
                        }
                    }

                    colIndex += colspan;
                });

                if (rowData.length > 0) {
                    if ($row.find('th').length > 0) {
                        headerRows.push(rowData);
                    } else {
                        tableData.push(rowData);
                    }
                }
            });

            allTables.push(new WikipediaTable(tableName, headerRows, tableData, currentSport, currentSubcategory));
        }
    });

    await browser.close();
    return allTables;
}

async function main() {
    const allData = {};
    for (const country of countries) {
        try {
            console.log(`\nScraping data for ${country}...`);
            const olympicData = await scrapeOlympicTeam(country);
            console.log(`Data for ${country}:`, JSON.stringify(olympicData, null, 2));
            allData[country] = olympicData;
        } catch (error) {
            console.error(`Error scraping ${country}:`, error);
        }
    }

    // Save data to JSON file
    try {
        await fs.writeFile('./data/olympic_data.json', JSON.stringify(allData, null, 2));
        console.log('Data saved to olympic_data.json');
    } catch (error) {
        console.error('Error saving data to file:', error);
    }
}

main();