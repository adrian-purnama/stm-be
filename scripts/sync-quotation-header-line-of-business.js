/**
 * Sync QuotationHeader.lineOfBusiness from linked RFQ
 * ================================================
 *
 * PROBLEM (why list filters looked “empty” for non-karoseri):
 * ------------------------------------------------------------
 * - RFQ is the source of truth for LOB: RFQ.lineOfBusiness.type ∈
 *   karoseri | non_karoseri | service | sparepart
 * - QuotationHeader also has lineOfBusiness.type but the Mongoose schema
 *   DEFAULTS it to 'karoseri'.
 * - If a header was created or migrated without copying RFQ.lineOfBusiness,
 *   the header can stay 'karoseri' while the RFQ is service/sparepart/etc.
 * - Filtering only on header.lineOfBusiness.type then hides those rows.
 *
 * APP ALREADY MITIGATES THIS for API list queries by matching EITHER header LOB
 * OR rfqId in RFQs with that LOB (see buildLineOfBusinessMatchCondition).
 *
 * DATA FIX (what this script does):
 * ---------------------------------
 * For every quotation header with rfqId set, if header.lineOfBusiness.type
 * differs from RFQ.lineOfBusiness.type, optionally UPDATE the header to match
 * the RFQ so UI badges and future queries stay consistent.
 *
 * USAGE (run from stm-be directory so models/dotenv resolve):
 * -------------------------------------------------------------
 *   node scripts/sync-quotation-header-line-of-business.js           # dry-run: report only
 *   node scripts/sync-quotation-header-line-of-business.js --fix    # apply updates
 *
 * Uses the same Mongo URI rules as server.js (MONGODB_PREPROD_URL /
 * MONGODB_PROD_URL + NODE_ENV_BUILD). Ensure .env is configured.
 *
 * Do NOT commit secrets; do NOT run against production without a backup.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const QuotationHeader = require('../models/quotationHeader.model');
const { RFQ } = require('../models/rfq.model');

function getMongoUri() {
  if (process.env.NODE_ENV_BUILD === 'production') {
    return process.env.MONGODB_PROD_URL;
  }
  return process.env.MONGODB_PREPROD_URL || process.env.MONGODB_URI;
}

async function main() {
  const applyFix = process.argv.includes('--fix');
  const mongoURI = getMongoUri();

  if (!mongoURI) {
    console.error('Missing Mongo URI. Set MONGODB_PREPROD_URL or MONGODB_PROD_URL (see server.js).');
    process.exit(1);
  }

  console.log('\n=== Quotation header LOB sync ===\n');
  console.log(`Mode: ${applyFix ? 'FIX (writes to DB)' : 'DRY-RUN (report only)'}\n`);

  await mongoose.connect(mongoURI, {
    dbName: process.env.MONGODB_DB_NAME || 'app',
    autoIndex: false
  });

  const headers = await QuotationHeader.find({
    rfqId: { $exists: true, $ne: null }
  })
    .select('_id quotationNumber rfqId lineOfBusiness')
    .lean();

  const rfqIdStrings = [...new Set(headers.map((h) => String(h.rfqId)))];
  const rfqs = await RFQ.find({ _id: { $in: rfqIdStrings } })
    .select('_id rfqNumber lineOfBusiness')
    .lean();

  const rfqMap = new Map(rfqs.map((r) => [String(r._id), r]));

  /** @type {{ headerId: string, quotationNumber: string, rfqId: string, rfqNumber?: string, headerType: string, rfqType: string }[]} */
  const mismatches = [];

  for (const h of headers) {
    const rfq = rfqMap.get(String(h.rfqId));
    if (!rfq) continue;

    const headerType = h.lineOfBusiness?.type ?? 'karoseri';
    const rfqType = rfq.lineOfBusiness?.type ?? 'karoseri';

    if (headerType !== rfqType) {
      mismatches.push({
        headerId: String(h._id),
        quotationNumber: h.quotationNumber,
        rfqId: String(h.rfqId),
        rfqNumber: rfq.rfqNumber,
        headerType,
        rfqType
      });
    }
  }

  console.log(`Checked ${headers.length} headers with rfqId.\n`);
  console.log(`Mismatched header vs RFQ LOB: ${mismatches.length}\n`);

  if (mismatches.length === 0) {
    console.log('Nothing to do.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('Sample (up to 15):\n');
  mismatches.slice(0, 15).forEach((row, i) => {
    console.log(
      `${i + 1}. ${row.quotationNumber} | header=${row.headerType} rfq=${row.rfqType} | rfq#=${row.rfqNumber || row.rfqId}`
    );
  });
  if (mismatches.length > 15) {
    console.log(`... and ${mismatches.length - 15} more\n`);
  }

  if (!applyFix) {
    console.log('\nNo writes performed. Run with --fix to set header.lineOfBusiness = RFQ.lineOfBusiness for each row.\n');
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const row of mismatches) {
    const rfq = rfqMap.get(row.rfqId);
    const lobFromRfq = rfq?.lineOfBusiness || { type: row.rfqType };

    const res = await QuotationHeader.updateOne(
      { _id: row.headerId },
      { $set: { lineOfBusiness: { type: lobFromRfq.type } } }
    );
    if (res.modifiedCount) updated += 1;
  }

  console.log(`\nUpdated ${updated} quotation header(s).\n`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
