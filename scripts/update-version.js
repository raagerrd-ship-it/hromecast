#!/usr/bin/env node
/**
 * Version Sync Script
 * 
 * Updates the BRIDGE_VERSION in all three locations:
 * 1. src/config/version.ts (source of truth for web app)
 * 2. bridge/index.js (local bridge service)
 * 3. supabase/functions/download-bridge/index.ts (downloadable bridge)
 * 
 * Usage:
 *   node scripts/update-version.js 1.2.0
 *   node scripts/update-version.js patch   # 1.1.0 -> 1.1.1
 *   node scripts/update-version.js minor   # 1.1.0 -> 1.2.0
 *   node scripts/update-version.js major   # 1.1.0 -> 2.0.0
 */

const fs = require('fs');
const path = require('path');

const FILES = [
  {
    path: 'src/config/version.ts',
    pattern: /export const BRIDGE_VERSION = "(.+?)";/,
    template: (v) => `export const BRIDGE_VERSION = "${v}";`
  },
  {
    path: 'bridge/index.js',
    pattern: /const BRIDGE_VERSION = '(.+?)';/,
    template: (v) => `const BRIDGE_VERSION = '${v}';`
  },
  {
    path: 'supabase/functions/download-bridge/index.ts',
    pattern: /const BRIDGE_VERSION = '(.+?)';/,
    template: (v) => `const BRIDGE_VERSION = '${v}';`
  }
];

function getCurrentVersion() {
  const versionFile = path.join(process.cwd(), 'src/config/version.ts');
  const content = fs.readFileSync(versionFile, 'utf-8');
  const match = content.match(/export const BRIDGE_VERSION = "(.+?)";/);
  if (!match) {
    throw new Error('Could not find current version in src/config/version.ts');
  }
  return match[1];
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function updateFile(fileDef, newVersion) {
  const filePath = path.join(process.cwd(), fileDef.path);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠️  File not found: ${fileDef.path}`);
    return false;
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(fileDef.pattern);
  
  if (!match) {
    console.warn(`  ⚠️  Version pattern not found in: ${fileDef.path}`);
    return false;
  }
  
  const oldVersion = match[1];
  content = content.replace(fileDef.pattern, fileDef.template(newVersion));
  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log(`  ✅ ${fileDef.path}: ${oldVersion} → ${newVersion}`);
  return true;
}

function main() {
  const arg = process.argv[2];
  
  if (!arg) {
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/update-version.js <version>');
    console.log('  node scripts/update-version.js patch|minor|major');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/update-version.js 1.2.0');
    console.log('  node scripts/update-version.js patch');
    console.log('');
    
    const current = getCurrentVersion();
    console.log(`Current version: ${current}`);
    process.exit(0);
  }
  
  const currentVersion = getCurrentVersion();
  let newVersion;
  
  if (['major', 'minor', 'patch'].includes(arg)) {
    newVersion = bumpVersion(currentVersion, arg);
  } else if (isValidVersion(arg)) {
    newVersion = arg;
  } else {
    console.error(`❌ Invalid version or bump type: ${arg}`);
    console.error('   Use a version like "1.2.0" or a bump type: major, minor, patch');
    process.exit(1);
  }
  
  console.log('');
  console.log(`📦 Updating version: ${currentVersion} → ${newVersion}`);
  console.log('');
  
  let successCount = 0;
  for (const fileDef of FILES) {
    if (updateFile(fileDef, newVersion)) {
      successCount++;
    }
  }
  
  console.log('');
  console.log(`✨ Done! Updated ${successCount}/${FILES.length} files.`);
  console.log('');
  console.log('Remember to:');
  console.log('  1. Test the changes locally');
  console.log('  2. Commit and push to deploy');
  console.log('');
}

main();
