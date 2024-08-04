import fs from 'fs/promises';


export async function writeToFile(fileName, content) {
        try {
        await fs.writeFile(`./data/${fileName}.json`, JSON.stringify(content, null, 2));
        console.log(`Data saved to ${fileName}`);
    } catch (error) {
        console.error('Error saving data to file:', error);
    }
}

