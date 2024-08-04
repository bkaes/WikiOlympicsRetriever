import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv'
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config()
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const readFile = promisify(fs.readFile);

async function bulkUpload(jsonFilePath) {
    try {
        const jsonContent = await readFile(jsonFilePath, 'utf8');
        const jsonData = JSON.parse(jsonContent);

        const disciplines = new Map();
        const events = new Map();
        const phases = new Map();
        const eventUnits = [];
        const competitors = [];
        const results = [];
        const detailedResults = [];
        const extraData = [];

        const competitorSet = new Set(); // To check for duplicates
        jsonData.units.forEach(unit => {
            // Process disciplines
            if (!disciplines.has(unit.disciplineCode)) {
                disciplines.set(unit.disciplineCode, {
                    name: unit.disciplineName,
                    code: unit.disciplineCode,
                    order_num: unit.disciplineOrder || null
                });
            }

            // Process events
            if (!events.has(unit.eventId)) {
                events.set(unit.eventId, {
                    name: unit.eventName,
                    code: unit.eventId,
                    gender_code: unit.genderCode,
                    event_order: unit.eventOrder || null
                });
            }

            // Process phases
            if (!phases.has(unit.phaseId)) {
                phases.set(unit.phaseId, {
                    name: unit.phaseName,
                    code: unit.phaseId,
                    phase_type: unit.phaseType,
                    phase_code: unit.phaseCode  // Add this line
                });
            }


            // Process event units
            eventUnits.push({
                name: unit.eventUnitName,
                code: unit.id,
                start_date: unit.startDate,
                end_date: unit.endDate,
                medal_flag: unit.medalFlag,
                status: unit.status,
                status_description: unit.statusDescription,
                schedule_item_type: unit.scheduleItemType,
                olympic_day: unit.olympicDay,
                order_num: unit.order,
                unit_num: unit.unitNum,
                session_code: unit.sessionCode,
                hide_start_date: unit.hideStartDate,
                hide_end_date: unit.hideEndDate,
                start_text: unit.startText,
                location: unit.location,
                location_description: unit.locationDescription,
                event_unit_type: unit.eventUnitType,
                group_id: unit.groupId,
                live_flag: unit.liveFlag,
                phase_code: unit.phaseCode
            });

            // Process competitors and results
            if (unit.competitors) {
                unit.competitors.forEach((comp, compIndex) => {
                    const competitorId = `${unit.id}-${compIndex}`;
                    
                    if (!competitorSet.has(competitorId)) {
                        competitorSet.add(competitorId);
                        competitors.push({
                            id: competitorId,
                            code: comp.code,
                            name: comp.name,
                            event_unit_code: unit.id,
                            country_code: comp.noc,
                            order_num: comp.order
                        });
                    }

                    if (comp.results) {
                        results.push({
                            id: `${competitorId}-result`,
                            competitor_id: competitorId,
                            event_unit_code: unit.id,
                            position: comp.results.position,
                            mark: comp.results.mark,
                            medal_type: comp.results.medalType,
                            irm: comp.results.irm,
                            winner_loser_tie: comp.results.winnerLoserTie,
                        });
                    }
                });
            }
        });

    // Bulk insert data
/*     await bulkInsert('disciplines', Array.from(disciplines.values()));
 */    await bulkInsert('events_2', Array.from(events.values()));
        await bulkInsert('phases', Array.from(phases.values()));
        await bulkInsert('event_units', eventUnits);
        await bulkInsert('competitors', competitors);
        await bulkInsert('results', results);
        await bulkInsert('detailed_results', detailedResults);
        await bulkInsert('extra_data', extraData);

        console.log('Bulk upload completed successfully.');
    } catch (error) {
        console.error('Error during bulk upload:', error);
    }
}

async function bulkInsert(table, data) {
    if (data.length === 0) {
        console.log(`No data to insert for table: ${table}`);
        return;
    }

    const chunkSize = 1000; // Adjust based on your Supabase limits
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        const { error } = await supabase.from(table).upsert(chunk, { 
            onConflict: 'id',
            ignoreDuplicates: false
        });
        if (error) {
            console.error(`Error inserting into ${table}:`, error);
        } else {
            console.log(`Successfully inserted/updated ${chunk.length} rows in ${table}`);
        }
    }
}

// Usage
const jsonFilePath = path.join(__dirname, './opp-data/full-schedule.json');
bulkUpload(jsonFilePath);