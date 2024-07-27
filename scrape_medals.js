import fetch from 'node-fetch'
import cheerio from 'cheerio'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config()
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

async function fetchMedalTable() {
    const url = 'https://en.wikipedia.org/w/api.php';
    const params = new URLSearchParams({
        action: 'parse',
        page: '2024_Summer_Olympics_medal_table',
        prop: 'text',
        section: '2',
        format: 'json',
        maxlag: MAXLAG
    });

    const options = {
        headers: {
            'User-Agent': 'OlympicMedalScraper/1.0 ('+ process.env.USER_AGENT_EMAIL + ')',
            'Accept-Encoding': 'gzip'
        }
    };

    const response = await fetchWithRetry(`${url}?${params}`, options);
    const data = await response.json();

    if (data.error) {
        if (data.error.code === 'maxlag') {
            console.log(`Maxlag error. Suggested delay: ${data.error.info}`);
            // Implement delay and retry logic here if needed
        }
        throw new Error(`API Error: ${data.error.info}`);
    }

    return data.parse.text['*'];
}

async function scrapeMedalTable(html) {
    const $ = cheerio.load(html);
    const medalData = [];
    $('table.wikitable').each((_, table) => {
        const caption = $(table).find('caption').text().trim();
        if (caption.includes('Summer Olympics medal table')) {
            $(table).find('tbody tr').each((_, element) => {
                const $tds = $(element).find('td');
                const $th = $(element).find('th');
                if ($tds.length >= 4 && $th.length === 1) {
                    const country = $th.text().trim().replace(/\s*\*$/, '');
                    if (!countries.includes(country)) {
                        return true;
                    }
                    const gold = parseInt(($tds.length == 4 ? $tds.eq(0) : $tds.eq(1)).text().trim(), 10);
                    const silver = parseInt(($tds.length == 4 ? $tds.eq(1) : $tds.eq(2)).text().trim(), 10);
                    const bronze = parseInt(($tds.length == 4 ? $tds.eq(2) : $tds.eq(3)).text().trim(), 10);
                    const total = parseInt(($tds.length == 4 ? $tds.eq(3) : $tds.eq(4)).text().trim(), 10);
                    medalData.push({
                        country,
                        gold,
                        silver,
                        bronze,
                        total
                    });
                }
            });
        }
    });
    return medalData;
}


async function updateMedalCounts(medalData) {
    const { data, error } = await supabase
        .rpc('update_medal_counts', { medal_data: medalData });
    if (error) {
        console.error('Error calling update_medal_counts:', error);
        return;
    }
    data.forEach(result => {
        if (result.updated) {
            console.log(`Updated MedalCount for ${result.country}`);
        } else {
            console.warn(`Failed to update MedalCount for ${result.country}: ${result.error}`);
        }
    });
}


async function main() {
    try {
        console.log("Fetching medal table...");
        const html = await fetchMedalTable();
        console.log("Scraping medal table...");
        const medalData = await scrapeMedalTable(html);
        console.log("Medal data:", JSON.stringify(medalData, null, 2));
        await updateMedalCounts(medalData);
        console.log("Finished updating Supabase");
    } catch (error) {
        console.error("Error processing medal data:", error);
    }
}

main();