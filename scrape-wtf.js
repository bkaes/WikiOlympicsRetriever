import fetch from 'node-fetch'
import cheerio from 'cheerio'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import wtf from 'wtf_wikipedia';
import { writeToFile } from './utilities.js';
import { parse, format } from 'date-fns';

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

const medalParsers = {
    'gold medal': () => 'Gold',
    'silver medal': () => 'Silver',
    'bronze medal': () => 'Bronze',
}



wtf.extend((models, templates) => {
    Object.entries(medalParsers).forEach(([templateName, parser]) => {
        templates[templateName] = parser
    })

    // Override the default table parser to handle medal templates
    const originalTableParser = models.Table.prototype.parse
    models.Table.prototype.parse = function (wiki, doc) {
        // Call the original parser first
        const table = originalTableParser.call(this, wiki, doc)

        // Process each cell in the table
        table.forEach(row => {
            Object.keys(row).forEach(key => {
                if (typeof row[key] === 'object' && row[key].template) {
                    const medalParser = medalParsers[row[key].template.toLowerCase()]
                    if (medalParser) {
                        row[key] = medalParser()
                    }
                }
            })
        })

        return table
    }
})

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

function replaceSpaceWithUnderscore(country) 
{
    return country.replace(/ /g, '_');
}

async function fetchPageContent(country) {
    const url = 'https://en.wikipedia.org/w/api.php';
    const params = new URLSearchParams({
        action: 'parse',
        page: `${replaceSpaceWithUnderscore(country)}_at_the_2024_Summer_Olympics`,
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



async function parseWikipediaContent(wikitext) {
    const doc = wtf(wikitext);
    const sections = doc.sections();
    const eventData = [];

    function processSections(sections, parentTitle = null) {
        for (let section of sections) {
            console.log(`Section: ${section.title()}${parentTitle ? ` (Parent: ${parentTitle})` : ''}`);
            
            const tables = section.tables();
            for (let table of tables) {
                const tableData = {
                    sectionTitle: section.title(),
                    subsectionTitle: parentTitle,
                    tableData: table.json()
                };
                eventData.push(tableData);
            }

            // Process child sections recursively
            if (section.children().length > 0) {
                processSections(section.children(), section.title());
            }
        }
    }

    processSections(sections);
    return eventData;
}

function extractFirstMedalistSection(eventData) {
    for (let section of eventData) {
        if (section.sectionTitle === "Medalists") {
            return section;
        }
    }
    console.log("No medalists section found")
    return null;
}
async function updateFirstMedalistSection(country, medalData) {
    if (!medalData || !medalData.tableData) {
        console.error('Invalid medal data structure');
        return;
    }
    for (const row of medalData.tableData) {
        const sport = row.Sport.text;
        const event = row.Event.text;
        const medal = row.Medal.text.toLowerCase().replace(' medal', '');
        const athleteNames = Array.isArray(row.Name.text) ? row.Name.text : [row.Name.text];
        
        // Convert date to full date format
        const partialDate = row.Date.text;
        let fullDate;
        try {
            const parsedDate = parse(partialDate + ' 2024', 'd MMMM yyyy', new Date());
            fullDate = format(parsedDate, 'yyyy-MM-dd');
        } catch (error) {
            console.error(`Error parsing date: ${partialDate}`, error);
            continue; // Skip this row if date parsing fails
        }

        const dataToSend = {
            p_country_name: country,
            p_sport: sport,
            p_event: event,
            p_medal: medal,
            p_athlete_names: athleteNames,
            p_date: fullDate
        };

        console.log('Data to be sent:', JSON.stringify(dataToSend, null, 2));

        try {
            const { data, error } = await supabase.rpc('upsert_medalists', dataToSend);
            
            if (error) {
                console.error('Error calling upsert_medalists:', error);
                console.error('Error details:', JSON.stringify(error, null, 2));
                continue;
            }
            
            if (data && data.length > 0) {
                const [result] = data;
                if (result.updated) {
                    console.log(`Medalist data updated successfully. ${result.message}`);
                } else {
                    console.log(`Medalist data operation completed. ${result.message}`);
                }
            } else {
                console.error('Unexpected response from upsert_medalists');
            }
        } catch (error) {
            console.error('Error updating medalist data:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
        }
    }
}
const sectionsToIgnore = ["Medalists", "Competitors"]
async function main() {
    try {
        for (const country of countries) {

            console.log(`Fetching page content for ${country}...`);
            const wikitext = await fetchPageContent(country);
            console.log("Parsing event tables...");

            const eventData = await parseWikipediaContent(wikitext);
            try {
                const medalistSection = extractFirstMedalistSection(eventData)
                console.log("medalist table found")
                if (medalistSection) {
                    await updateFirstMedalistSection(country, medalistSection)
                    console.log('medalistTable updated')
                }
            }
            catch (error) {
                console.log(`Error updating ${country} Medalist section`, error);

            }
            await writeToFile(`wtf-event_data-${country}`, eventData)
        }
    }
    catch (error) {
        console.error("Error processing event data:", error);
    }
}


main()