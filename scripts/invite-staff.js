#!/usr/bin/env node
import { pool } from '../db.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as staffAuthService from '../services/staffAuthService.js';

function parseArgs(argv) {
  const args = { home: '', staff: '', allActive: false, createdBy: 'cli:invite-staff' };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--home') args.home = argv[++index] || '';
    else if (token === '--staff') args.staff = argv[++index] || '';
    else if (token === '--all-active') args.allActive = true;
    else if (token === '--created-by') args.createdBy = argv[++index] || args.createdBy;
  }
  return args;
}

function printUsage() {
  console.error('Usage: node scripts/invite-staff.js --home <home-slug> --staff <staff-id>');
  console.error('   or: node scripts/invite-staff.js --home <home-slug> --all-active');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.home || (!args.staff && !args.allActive) || (args.staff && args.allActive)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const home = await homeRepo.findBySlug(args.home);
  if (!home) {
    console.error(`Home not found: ${args.home}`);
    process.exitCode = 1;
    return;
  }

  let staffRows = [];
  if (args.staff) {
    const staff = await staffRepo.findById(home.id, args.staff);
    if (!staff) {
      console.error(`Staff member not found: ${args.staff}`);
      process.exitCode = 1;
      return;
    }
    staffRows = [staff];
  } else {
    const { rows } = await staffRepo.findByHome(home.id, { limit: 10000, offset: 0 });
    staffRows = rows.filter((staff) => staff.active !== false);
  }

  if (staffRows.length === 0) {
    console.log('No active staff members matched.');
    return;
  }

  const results = [];
  for (const staff of staffRows) {
    try {
      const invite = await staffAuthService.createInvite({
        homeId: home.id,
        staffId: staff.id,
        createdBy: args.createdBy,
      });
      results.push({
        staffId: staff.id,
        name: staff.name,
        inviteUrl: invite.inviteUrl,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      results.push({
        staffId: staff.id,
        name: staff.name,
        error: error.message,
      });
    }
  }

  console.log(JSON.stringify({
    home: home.slug,
    count: results.length,
    results,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
