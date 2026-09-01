/**
 * Migration: Backfill master_staff_identities from Branch 1 and Branch 2 databases.
 */

const branchManager = require('../config/branchManager');
const identityRegistry = require('../services/identityRegistry');
const { normalizeUsername, normalizePhone } = require('../utils/phoneHelper');

async function runBackfill() {
  console.log('--- Step 1: Initializing Master DB Tables ---');
  await branchManager.initMasterDb();

  console.log('--- Step 2: Pre-Migration Conflict Scan ---');
  const scan1 = await identityRegistry.scanIdentityConflicts();
  console.log(`Scanned ${scan1.totalScanned} users across all branches.`);
  if (scan1.duplicatesFound) {
    console.warn(`[Conflict Warning] Found ${scan1.conflicts.length} duplicate conflicts:`);
    scan1.conflicts.forEach((c, idx) => {
      console.warn(`  Conflict #${idx + 1} (${c.type}): Value "${c.conflictingValue}" in Branch ${c.primaryUser.branchId} (${c.primaryUser.userId}) and Branch ${c.conflictingUser.branchId} (${c.conflictingUser.userId})`);
    });

    // Check if the conflict is Branch 2's default seeded 'admin' conflicting with Branch 1 'admin'
    for (const c of scan1.conflicts) {
      if (c.type === 'USERNAME_DUPLICATE' && c.conflictingValue === 'admin') {
        const b2User = c.primaryUser.branchId === 2 ? c.primaryUser : (c.conflictingUser.branchId === 2 ? c.conflictingUser : null);
        if (b2User) {
          console.log(`Aligning Branch 2 user (${b2User.userId}) username with Master Registry registered admin username ('admin2')...`);
          const pool2 = await branchManager.getBranchPool(2, true);
          await pool2.query(
            "UPDATE users SET username = 'admin2' WHERE id = $1 AND username = 'admin'",
            [b2User.userId]
          );
        }
      }
    }
  } else {
    console.log('No duplicate conflicts found.');
  }

  console.log('--- Step 3: Rescan Verification ---');
  const scan2 = await identityRegistry.scanIdentityConflicts();
  if (scan2.duplicatesFound) {
    console.error('[Error] Unresolved conflicts remain. Cannot proceed with backfill:');
    console.error(scan2.conflicts);
    process.exit(1);
  }
  console.log(`Verification passed: 0 duplicate usernames, 0 duplicate phones across all ${scan2.totalScanned} users.`);

  console.log('--- Step 4: Backfilling master_staff_identities ---');
  // Clear any existing identities to ensure clean backfill
  await branchManager.masterPool.query('TRUNCATE TABLE master_staff_identities RESTART IDENTITY CASCADE');

  let backfilledCount = 0;
  for (const user of scan2.allUsers) {
    const normUser = normalizeUsername(user.rawUsername);
    const normPhone = normalizePhone(user.rawContact);

    await branchManager.masterPool.query(
      `INSERT INTO master_staff_identities (
        branch_id, branch_user_id, normalized_username, normalized_phone,
        role, status, reservation_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`,
      [user.branchId, user.userId, normUser, normPhone, user.role, user.status || 'Active']
    );
    backfilledCount++;
    console.log(`  + Registered [Branch ${user.branchCode}] ID: ${user.userId} | Username: ${normUser} | Phone: ${normPhone || '(none)'} | Role: ${user.role}`);
  }

  console.log(`--- Step 5: Final Integrity Check ---`);
  const countRes = await branchManager.masterPool.query('SELECT COUNT(*) as total FROM master_staff_identities');
  const totalMaster = parseInt(countRes.rows[0].total, 10);
  console.log(`Total master_staff_identities records: ${totalMaster} (Matches branch users: ${totalMaster === backfilledCount})`);

  if (totalMaster !== scan2.totalScanned) {
    throw new Error(`Integrity error: master count (${totalMaster}) does not match scanned count (${scan2.totalScanned})`);
  }

  console.log('\nSUCCESS! Master Staff Identity Registry backfill completed cleanly without errors.');
  process.exit(0);
}

runBackfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
