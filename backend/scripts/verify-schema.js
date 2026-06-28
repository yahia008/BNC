const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'drizzle.config.ts');
const CONFIG_JS_PATH = path.join(__dirname, '..', 'drizzle.config.js');

// Try to load config
let config;
try {
  // If we have a ts file, use simple regex to get schema path (avoids ts-node dependency)
  if (fs.existsSync(CONFIG_PATH)) {
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    const schemaMatch = configContent.match(/schema:\s*['"](.*?)['"]/);
    if (schemaMatch) {
      config = { schema: schemaMatch[1] };
    }
  } else if (fs.existsSync(CONFIG_JS_PATH)) {
    config = require(CONFIG_JS_PATH);
  }
} catch (err) {
  console.error('❌ Error loading Drizzle config:', err);
  process.exit(1);
}

if (!config || !config.schema) {
  console.error('❌ Could not find schema path in Drizzle config');
  process.exit(1);
}

const schemaPath = path.resolve(path.dirname(CONFIG_PATH), config.schema);
if (!fs.existsSync(schemaPath)) {
  console.error(`❌ Schema file does not exist at: ${schemaPath}`);
  process.exit(1);
}

console.log(`✅ Schema path is valid: ${schemaPath}`);
