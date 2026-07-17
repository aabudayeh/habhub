const fs = require('node:fs');
const path = require('node:path');

function readDotEnv(filename) {
  const fullPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(fullPath)) return {};
  return Object.fromEntries(fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, '')]];
  }));
}

const values = { ...readDotEnv('.env'), ...readDotEnv('.env.local'), ...process.env };
const url = values.EXPO_PUBLIC_SUPABASE_URL;
const key = values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const requireCloud = process.argv.includes('--cloud');
const placeholder = (value) => !value || /YOUR_|example|localhost/i.test(value);
const issues = [];

if (Boolean(url) !== Boolean(key)) issues.push('Set both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or neither.');
if (requireCloud && (placeholder(url) || placeholder(key))) issues.push('Production cloud values are missing or still placeholders.');
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) issues.push('EXPO_PUBLIC_SUPABASE_URL should be the HTTPS project URL.');
if (key && key.length < 20) issues.push('The Supabase publishable key looks incomplete.');

const app = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8')).expo;
if (!app.ios?.bundleIdentifier || !app.android?.package) issues.push('Both iOS bundleIdentifier and Android package are required.');
if (!app.scheme) issues.push('A custom URL scheme is required for native authentication callbacks.');

if (issues.length) {
  console.error('Release configuration needs attention:\n');
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exit(1);
}

console.log(`Release environment is valid (${url && key ? 'cloud enabled' : 'credential-free demo'}).`);

