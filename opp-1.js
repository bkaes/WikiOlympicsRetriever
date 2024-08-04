import fs from 'fs';
import Fuse from 'fuse.js';
// Read JSON files
const entries = JSON.parse(fs.readFileSync('./opp-data/all-entries.json', 'utf8'));
const schedule = JSON.parse(fs.readFileSync('./opp-data/cleaned_schedule.json', 'utf8'));

const countries = [
    /*   'Iran', 'Denmark', 'Turkey', 'New_Zealand', 'Ukraine', 'Ethiopia', 'Kenya', 'Sweden', */
    'Belgium', /* 'Georgia', 'Uzbekistan', 'Switzerland' */
];

const countryCodes = {
    Iran: 'IRI', Denmark: 'DEN', Turkey: 'TUR', New_Zealand: 'NZL',
    Ukraine: 'UKR', Ethiopia: 'ETH', Kenya: 'KEN', Sweden: 'SWE',
    Belgium: 'BEL', Georgia: 'GEO', Uzbekistan: 'UZB', Switzerland: 'SUI'
};

function cleanEventCode(code) {
    return code.replace(/[-]/g, '');
}

// Function to get current phase and next event date
function getEventDetails(eventCode, athleteName) {
    const event = schedule.units.find(unit => unit.eventId === cleanEventCode(eventCode));

    if (!event) return { phase: 'Unscheduled', nextDate: 'TBD' };

    // Collect all phases
    let allPhases = event.phases || [];

    // Filter out finished phases and sort the remaining phases by start date
    const upcomingPhases = allPhases.filter(phase => phase.status !== 'FINISHED')
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (upcomingPhases.length > 0) {
        const currentPhase = upcomingPhases[0];
        return { phase: currentPhase.description, nextDate: currentPhase.startDate };
    }

    return { phase: 'Finished', nextDate: 'TBD' };
}

// Function to check if an athlete is still active and get details
function getAthleteStatus(eventCode, athleteName) {
    const event = schedule.units.find(unit => unit.eventId === cleanEventCode(eventCode));
    if (!event) return { isActive: true, reason: 'Event not yet scheduled' };

    const fuse = new Fuse(event.competitors || [], {
        keys: ['name'],
        threshold: 0.3,
    });

    // Check if the event has medal rounds
    const hasMedalRounds = event.phases && event.phases.some(phase =>
        phase.description.toLowerCase().includes('final') ||
        phase.description.toLowerCase().includes('medal')
    );
    // Find the latest non-finished phase
    const currentPhase = event.phases ? 
        event.phases.filter(phase => phase.status !== 'FINISHED')
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))[0] 
        : null;

    if (currentPhase) {
        // Check if the athlete is in the current phase
        const athleteInPhase = fuse.search(athleteName).length > 0;
        if (athleteInPhase) {
            return { 
                isActive: true, 
                reason: hasMedalRounds ? 'In contention for medal' : 'Still in competition',
                currentPhase: currentPhase.description
            };
        }
    }

    // Check for future events
    const futureEvents = schedule.units.filter(unit => 
        new Date(unit.startDate) > new Date() &&
        unit.eventId === cleanEventCode(eventCode) &&
        fuse.search(athleteName).length > 0
    );

    if (futureEvents.length > 0) {
        return { 
            isActive: true, 
            reason: 'Upcoming event found',
            nextEvent: futureEvents[0].description
        };
    }

    return { isActive: false, reason: 'No more scheduled events' };
}

// Process entries
function processCountry(countryCode) {
    const countryAthletes = entries.persons
        .filter(person => person.organisation.code === countryCode)
        .flatMap(person => person.registeredEvents.map(event => {
            const { isActive, reason } = getAthleteStatus(cleanEventCode(event.event.code), person.name);
            const { phase, nextDate } = getEventDetails(cleanEventCode(event.event.code), person.name);
            return {
                athlete_name: person.name,
                event_name: event.event.description,
                event_code: cleanEventCode(event.event.code),
                isActive,
                phase,
                nextDate,
                reason
            };
        }));

    // Separate active and inactive athletes
    const activeAthletes = countryAthletes.filter(athlete => athlete.isActive);
    const inactiveAthletes = countryAthletes.filter(athlete => !athlete.isActive);

    // Prepare the result object
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
    }
}

// Write results to a file
const allCountriesData = {};
countries.forEach(country => {
    const countryCode = countryCodes[country];
    const countryData = processCountry(countryCode);
    allCountriesData[country] = countryData;

    // Write individual country file
    fs.writeFileSync(`./opp-data/results/${country.toLowerCase()}_athletes_status.json`, JSON.stringify(countryData, null, 2), 'utf8');
    console.log(`Results for ${country} have been written to ${country.toLowerCase()}_athletes_status.json`);
});
