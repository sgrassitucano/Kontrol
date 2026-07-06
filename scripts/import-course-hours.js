#!/usr/bin/env node
const XLSX = require('xlsx-js-style');
const fetch = require('node-fetch');

async function importCourseHours(filePath, apiUrl, authToken) {
  try {
    console.log(`Reading file: ${filePath}`);
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws);

    console.log(`Parsed ${data.length} rows`);

    const response = await fetch(`${apiUrl}/api/formazione/pianificazione/import-hours`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Error:', result.error);
      process.exit(1);
    }

    console.log(`✓ Success: ${result.message}`);
    console.log(`  Imported: ${result.imported} corsi`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Usage: node scripts/import-course-hours.js <file> <apiUrl> <authToken>
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node scripts/import-course-hours.js <file> <apiUrl> <authToken>');
  console.log('Example: node scripts/import-course-hours.js ore_corsi_compilato_2025.xlsx http://localhost:3000 your_token');
  process.exit(1);
}

importCourseHours(args[0], args[1], args[2]);
