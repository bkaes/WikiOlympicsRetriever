import fs from 'fs';

// Read JSON files
const entries = JSON.parse(fs.readFileSync('./opp-data/all-entries.json', 'utf8'));
const schedule = JSON.parse(fs.readFileSync('./opp-data/cleaned_schedule.json', 'utf8'));

const countries = [
    'Iran', 'Denmark', 'Turkey', 'New_Zealand', 'Ukraine', 'Ethiopia', 'Kenya', 'Sweden',
    'Belgium', 'Georgia', 'Uzbekistan', 'Switzerland'
];

const countryCodes = {
    Iran: 'IRI', Denmark: 'DEN', Turkey: 'TUR', New_Zealand: 'NZL',
    Ukraine: 'UKR', Ethiopia: 'ETH', Kenya: 'KEN', Sweden: 'SWE',
    Belgium: 'BEL', Georgia: 'GEO', Uzbekistan: 'UZB', Switzerland: 'SUI'
};

// Function to clean event codes
function cleanEventCode(code) {
    return code.replace(/[-]/g, '');
}

// Create cleaned versions of schedule and entries
const cleanedSchedule = {};
for (const [key, value] of Object.entries(schedule)) {
    cleanedSchedule[cleanEventCode(key)] = value;
}

entries.persons.forEach(person => {
    person.registeredEvents.forEach(event => {
        event.event.cleanedCode = cleanEventCode(event.event.code);
    });
});

// Function to get current phase and next event date
function getEventDetails(eventCode) {
    const event = schedule.find(event => event.eventId === eventCode);
        if (!event) return { phase: 'Unscheduled', nextDate: 'TBD' };

    let currentPhase = 'Unknown';
    let nextDate = 'TBD';

    // Find the latest non-finished phase
    for (const phase of event.phases || []) {
        if (phase.status !== 'FINISHED') {
            currentPhase = phase.description;
            nextDate = phase.startDate || 'TBD';
            break;
        }
    }

    return { phase: currentPhase, nextDate };
}

// Function to check if an athlete is still active and get details
function getAthleteStatus(eventCode) {
    const event = cleanedSchedule[eventCode];
    if (!event) return { isActive: true, reason: 'Event not yet scheduled' };

    const latestPhase = event.phases ? event.phases[event.phases.length - 1] : null;
    if (latestPhase && latestPhase.status === 'FINISHED') {
        return { isActive: false, reason: 'Event concluded' };
    }

    return { isActive: true, reason: 'Still in competition' };
}

// Process entries for a country
function processCountry(countryCode) {
    const countryAthletes = entries.persons
        .filter(person => person.organisation.code === countryCode)
        .flatMap(person => person.registeredEvents.map(event => {
            const { isActive, reason } = getAthleteStatus(event.event.cleanedCode);
            const { phase, nextDate } = getEventDetails(event.event.cleanedCode);
            return {
                athlete_name: person.name,
                event_name: event.event.description,
                event_code: event.event.cleanedCode,
                isActive,
                phase,
                nextDate,
                reason
            };
        }));

    const activeAthletes = countryAthletes.filter(athlete => athlete.isActive);
    const inactiveAthletes = countryAthletes.filter(athlete => !athlete.isActive);

    return {
        active_athletes: activeAthletes.map(({ athlete_name, event_name, event_code, phase, nextDate }) => ({
            athlete_name,
            event_name,
            event_code,
            current_phase: phase,
            next_event_date: nextDate
        })),
        inactive_athletes: inactiveAthletes.map(({ athlete_name, event_name, event_code, phase, reason }) => ({
            athlete_name,
            event_name,
            event_code,
            last_phase: phase,
            reason
        }))
    };
}

// Process all countries
const allCountriesData = {};
countries.forEach(country => {
    const countryCode = countryCodes[country];
    const countryData = processCountry(countryCode);
    allCountriesData[country] = countryData;

    // Write individual country file
    fs.writeFileSync(`./opp-data/results/${country.toLowerCase()}_athletes_status.json`, JSON.stringify(countryData, null, 2), 'utf8');
    console.log(`Results for ${country} have been written to ${country.toLowerCase()}_athletes_status.json`);
});

// Write summary file
const summary = Object.entries(allCountriesData).map(([country, data]) => ({
    country,
    active_athletes_count: data.active_athletes.length,
    inactive_athletes_count: data.inactive_athletes.length
}));

fs.writeFileSync('./opp-data/results/all_countries_summary.json', JSON.stringify(summary, null, 2), 'utf8');
console.log('Summary has been written to all_countries_summary.json');