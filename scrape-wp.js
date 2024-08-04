import fetch from 'node-fetch'
import cheerio from 'cheerio'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import Parser from 'wikiparser-node';
import { writeToFile } from './utilities.js';
import { write } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config()
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
//const supabase = createClient(supabaseUrl, supabaseKey);

const MAXLAG = 5; // Set maxlag parameter (in seconds)
const MAX_RETRIES = 3; // Maximum number of retries for rate-limited requests
const INITIAL_BACKOFF = 1000; // Initial backoff time in milliseconds

const countries = [
    'Iran', 'Denmark', 'Turkey', 'New Zealand', 'Ukraine', 'Ethiopia', 'Kenya', 'Sweden',
    'Belgium', 'Georgia', 'Uzbekistan', 'Switzerland'
];


async function fetchWithRetry(url, options, retries = 0) {
    try {
        const response = await fetch(url, options);

        if (response.status === 429 || (response.status === 500 && response.headers.get('retry-after'))) {
            if (retries >= MAX_RETRIES) {
                throw new Error('Max retries reached');
            }

            const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
            const backoffTime = Math.max(INITIAL_BACKOFF * Math.pow(2, retries), retryAfter * 1000);

            console.log(`Rate limited. Retrying after ${backoffTime}ms`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));

            return fetchWithRetry(url, options, retries + 1);
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response;
    } catch (error) {
        if (retries < MAX_RETRIES) {
            console.log(`Request failed. Retrying (${retries + 1}/${MAX_RETRIES})...`);
            return fetchWithRetry(url, options, retries + 1);
        } else {
            throw error;
        }
    }
}

async function fetchPageContent(country) {
    const url = 'https://en.wikipedia.org/w/api.php';
    const params = new URLSearchParams({
        action: 'parse',
        page: `${country}_at_the_2024_Summer_Olympics`,
        prop: 'wikitext',
        format: 'json',
        maxlag: MAXLAG.toString()
    });

    const options = {
        headers: {
            'User-Agent': 'OlympicEventScraper/1.0 (' + process.env.USER_AGENT_EMAIL + ')',
            'Accept-Encoding': 'gzip'
        }
    };

    const response = await fetchWithRetry(`${url}?${params}`, options);
    const data = await response.json();

    if (data.error) {
        if (data.error.code === 'maxlag') {
            console.log(`Maxlag error. Suggested delay: ${data.error.info}`);
        }
        throw new Error(`API Error: ${data.error.info}`);
    }

    return data.parse.wikitext['*'];
}
function parseEventTables(ast) {
    const eventData = [];
    let currentSport = null;
    let currentSubsport = null;

    function traverseAST(node) {
        if (node.type === 'heading') {
            if (node.level === 2) {
                currentSport = node.content[0].text;
                currentSubsport = null;
            } else if (node.level === 3) {
                currentSubsport = node.content[0].text;
            }
        } else if (node.type === 'table') {
            const tableData = parseTable(node);
            if (tableData.length > 0 && !isRosterTable(tableData[0])) {
                eventData.push({
                    sport: currentSport,
                    subsport: currentSubsport,
                    table: tableData
                });
            }
        }

        if (node.content) {
            node.content.forEach(traverseAST);
        }
    }

    function parseTable(tableNode) {
        return tableNode.content.map(row => {
            return row.content.map(cell => ({
                content: cell.content.map(c => c.text).join('').trim(),
                colspan: cell.colspan,
                rowspan: cell.rowspan
            }));
        });
    }

    function isRosterTable(headerRow) {
        return headerRow.some(cell => cell.content.toLowerCase().includes('roster'));
    }

    traverseAST(ast);
    return eventData;
}

async function main() {
    try {
        const country = 'Belgium'; // You can make this dynamic
        console.log(`Fetching page content for ${country}...`);
        const html = await fetchPageContent(country);
        console.log("Parsing event tables...");
        const eventData = parseEventTables(html);
        console.log("Event data:", JSON.stringify(eventData, null, 2));
        await writeToFile('wp-event_table', JSON.stringify(eventData, null, 2))
        console.log('Data saved to olympic_data.json');

    } catch (error) {
        console.error("Error processing event data:", error);
    }
}

main();