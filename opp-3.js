import fs from 'fs';

// Read schedule JSON file
const schedule = JSON.parse(fs.readFileSync('./opp-data/full-schedule.json', 'utf8'));

// Function to clean event codes
function cleanEventCode(code) {
    return code.replace(/[-]/g, '');
}

// Function to clean a unit
function cleanUnit(unit) {
    const cleanedUnit = {...unit};
    cleanedUnit.id = cleanEventCode(unit.id);
    cleanedUnit.eventId = cleanEventCode(unit.eventId);
    cleanedUnit.phaseId = cleanEventCode(unit.phaseId);
    cleanedUnit.disciplineId = cleanEventCode(unit.disciplineId);
    
    if (cleanedUnit.competitors) {
        cleanedUnit.competitors = cleanedUnit.competitors.map(competitor => ({
            ...competitor,
            code: cleanEventCode(competitor.code)
        }));
    }
    
    return cleanedUnit;
}

// Clean the schedule
const cleanedSchedule = {
    ...schedule,
    units: schedule.units.map(cleanUnit)
};

// Write cleaned schedule to a new file
fs.writeFileSync('./opp-data/cleaned_schedule.json', JSON.stringify(cleanedSchedule, null, 2), 'utf8');
console.log('Cleaned schedule has been written to cleaned_schedule.json');