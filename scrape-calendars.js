import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import https from 'https';
import ical from 'node-ical';
import { createClient } from '@supabase/supabase-js';
import { parse, format } from 'date-fns';
import dotenv from 'dotenv'
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config()
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const countries = [
    'Iran', 'Denmark', 'Turkey', 'New_Zealand', 'Ukraine', 'Ethiopia', 'Kenya', 'Sweden',
    'Belgium', 'Georgia', 'Uzbekistan', 'Switzerland'
];

const phases = [
    'Round 1', 'Round 2', 'Preliminary Round', 'Elimination Round',
    'Quarterfinal', 'Semifinal', 'Final', 'Bronze Medal Match', 'Gold Medal Match',
    'Group Play Stage', 'Pool A', 'Pool B', 'Qualification', 'Heats',
    'Repechages', 'Time Trial', 'Table of 64', 'Table of 32', 'Table of 16',
    'Table of 8', 'Placing 5-8', 'Placing 9-12', 'Ranking Round', 'Preliminary'
];

const nonMedalPhases = [
    'Placing 5-8', 'Placing 9-12', 'Ranking Round'
];

const countryFlags = {
    Iran: '🇮🇷', Denmark: '🇩🇰', Turkey: '🇹🇷', New_Zealand: '🇳🇿',
    Ukraine: '🇺🇦', Ethiopia: '🇪🇹', Kenya: '🇰🇪', Sweden: '🇸🇪',
    Belgium: '🇧🇪', Georgia: '🇬🇪', Uzbekistan: '🇺🇿', Switzerland: '🇨🇭'
};

const countryCodes = {
    Iran: 'IRI', Denmark: 'DEN', Turkey: 'TUR', New_Zealand: 'NZL',
    Ukraine: 'UKR', Ethiopia: 'ETH', Kenya: 'KEN', Sweden: 'SWE',
    Belgium: 'BEL', Georgia: 'GEO', Uzbekistan: 'UZB', Switzerland: 'SUI'
};

const CALENDARS_DIR = 'calendars';

function parseEventAndPhase(eventString) {
    let event = eventString;
    let phase = 'N/A';
    let cannotWinMedal = false;

    for (let p of phases) {
        if (eventString.includes(p)) {
            event = eventString.replace(p, '').trim();
            phase = p;
            break;
        }
    }

    // Handle special cases like "1/32 Elimination Round"
    if (event.includes('Elimination Round')) {
        const match = event.match(/(\d+\/\d+)\s+Elimination Round/);
        if (match) {
            phase = `${match[1]} Elimination Round`;
            event = event.replace(match[0], '').trim();
        }
    }

    // Check if the phase means they cannot win a medal
    if (nonMedalPhases.some(nmp => phase.includes(nmp))) {
        cannotWinMedal = true;
    }

    return { event, phase, cannotWinMedal };
}

async function ensureDirectoryExists(directory) {
    try {
        await fsPromises.access(directory);
    } catch {
        await fsPromises.mkdir(directory, { recursive: true });
    }
}

function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                const file = fs.createWriteStream(filePath);
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(filePath);
                });
            } else {
                reject(new Error(`Failed to download file: ${response.statusCode}`));
            }
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function getICSFile(country) {
    const filePath = path.join(CALENDARS_DIR, `${countryCodes[country]}.ics`);
/*     try {
        await fsPromises.access(filePath);
        console.log(`File for ${country} already exists, using local copy.`);
        return filePath;
    } catch {
        console.log(`Downloading file for ${country}...`); */
        const url = `https://fabrice404.github.io/olympics-calendar/general/${countryCodes[country]}.ics`;
        return downloadFile(url, filePath);
    }
//}

function parseICSFile(filePath, countryName) {
    return new Promise((resolve, reject) => {
        fsPromises.readFile(filePath, 'utf8')
            .then(data => {
                const events = ical.parseICS(data);
                const parsedEvents = [];

                for (let k in events) {
                    if (events[k].type === 'VEVENT') {
                        const event = events[k];
                        const description = event.description.split('\n');
                        const [sport, eventDetails] = description[0].split(' - ');
                        const { event: eventName, phase, cannotWinMedal } = parseEventAndPhase(eventDetails);

                        // Find athletes/teams for this country
                        const athletes = description.slice(1).filter(line => line.includes(countryFlags[countryName]))
                            .map(line => line.split(' ')[1].trim());

                        parsedEvents.push({
                            country: replaceUnderscoreWithSpace(countryName),
                            sport: sport,
                            event: eventName,
                            phase: phase,
                            cannotWinMedal: cannotWinMedal,
                            athletes: athletes,
                            startTime: event.start.toISOString(),
                            location: event.location
                        });
                    }
                }

                resolve(parsedEvents);
            })
            .catch(reject);
    });
}
function replaceSpaceWithUnderscore(country) 
{
    return country.replace(/ /g, '_');
}
function replaceUnderscoreWithSpace(country) {
    return country.replace(/_/g, ' ');
}
async function main() {
    try {
        await ensureDirectoryExists(CALENDARS_DIR);
        let allEvents = [];

        for (const country of countries) {
            try {
                const filePath = await getICSFile(country);
                const events = await parseICSFile(filePath, country);
                allEvents = allEvents.concat(events);
                console.log(`Processed ${events.length} events for ${country}`);
            } catch (error) {
                console.error(`Error processing ${country}:`, error);
            }
        }

        // Sort all events by start time
        allEvents.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        const { data, error } = await supabase.rpc('bulk_update_events', {
            p_events: allEvents
        });


        if (error) console.error('Error updating events:', error);
        else console.log('All events have been processed and saved to Supabase');
        // Write to file
        await fsPromises.writeFile('olympicsSchedule.json', JSON.stringify(allEvents, null, 2));
        console.log('All events have been processed and saved to olympicsSchedule.json');
    }
    catch (error) {
        console.log(error)
    }
}

main()