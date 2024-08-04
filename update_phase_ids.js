import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const readFile = promisify(fs.readFile);

async function updatePhaseIds(jsonFilePath) {
    try {
        const jsonContent = await readFile(jsonFilePath, 'utf8');
        const jsonData = JSON.parse(jsonContent);

        // Fetch all necessary data in one go
        const [eventUnitsRes, eventsRes, phasesRes] = await Promise.all([
            supabase.from('event_units').select('id, code, event_id, phase_id'),
            supabase.from('events_2').select('id, code'),
            supabase.from('phases').select('id, code, event_id')
        ]);

        if (eventUnitsRes.error || eventsRes.error || phasesRes.error) {
            console.error('Error fetching data:', eventUnitsRes.error || eventsRes.error || phasesRes.error);
            return;
        }

        const eventsMap = new Map(eventsRes.data.map(event => [event.code, event]));
        const phasesMap = new Map(phasesRes.data.map(phase => [phase.code, phase]));

        const updates = [];
        const errors = [];

        for (const unit of jsonData.units) {
            const eventId = eventsMap.get(unit.eventId)?.id;
            if (!eventId) {
                errors.push(`Event not found for unit ${unit.id}`);
                continue;
            }

            const matchingPhases = phasesRes.data.filter(phase => phase.event_id === eventId);
            if (matchingPhases.length === 0) {
                errors.push(`No phases found for event ${unit.eventId}`);
                continue;
            }

            const bestMatch = findBestMatch(unit.phaseId, matchingPhases);
            updates.push({ code: unit.id, phase_id: bestMatch.id });
        }

        // Perform batch update
        if (updates.length > 0) {
            const { data, error } = await supabase.from('event_units').upsert(updates, { onConflict: 'code' });
            if (error) {
                console.error('Error updating event_units:', error);
            } else {
                console.log(`Successfully updated ${data.length} event units.`);
            }
        }

        if (errors.length > 0) {
            console.error('Errors encountered:', errors);
        }

        console.log('Phase ID update completed.');
    } catch (error) {
        console.error('Error during phase ID update:', error);
    }
}

function findBestMatch(phaseCode, phases) {
    return phases.reduce((best, current) => {
        const currentDistance = levenshteinDistance(phaseCode, current.code);
        if (currentDistance < best.distance) {
            return { distance: currentDistance, id: current.id };
        }
        return best;
    }, { distance: Infinity, id: null });
}

function levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

// Usage
const jsonFilePath = path.join(__dirname, './opp-data/full-schedule.json');
updatePhaseIds(jsonFilePath);