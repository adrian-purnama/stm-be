const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Permission = require('../models/permission.model');
const PermissionCategory = require('../models/permissionCategory.model');

dotenv.config();

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  
  await mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
  
  try {
    // Find or create RFQ category
    let rfqCategory = await PermissionCategory.findOne({ name: 'RFQ Management' });
    if (!rfqCategory) {
      rfqCategory = new PermissionCategory({
        name: 'RFQ Management',
        description: 'Permissions related to Request for Quotation management'
      });
      await rfqCategory.save();
      console.log('✅ Created RFQ Management category');
    } else {
      console.log('✅ Found existing RFQ Management category');
    }

    // Create approve_rfq permission
    const approveRFQPermission = await Permission.findOne({ name: 'approve_rfq' });
    if (!approveRFQPermission) {
      const newPermission = new Permission({
        name: 'approve_rfq',
        description: 'Can approve or reject RFQ requests',
        category: rfqCategory._id
      });
      await newPermission.save();
      console.log('✅ Created approve_rfq permission');
    } else {
      console.log('✅ approve_rfq permission already exists');
    }

    // Create create_rfq permission
    const createRFQPermission = await Permission.findOne({ name: 'create_rfq' });
    if (!createRFQPermission) {
      const newPermission = new Permission({
        name: 'create_rfq',
        description: 'Can create new RFQ requests',
        category: rfqCategory._id
      });
      await newPermission.save();
      console.log('✅ Created create_rfq permission');
    } else {
      console.log('✅ create_rfq permission already exists');
    }

    console.log('🎉 RFQ permissions setup completed!');

  } catch (e) {
    console.error('❌ Error:', e);
  } finally {
    await mongoose.disconnect();
  }
}

main();
