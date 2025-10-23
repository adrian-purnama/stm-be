const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/user.model');
const Permission = require('../models/permission.model');
const { hasPermission, hasAnyPermission, getAllUserPermissions, isSuperAdmin } = require('../utils/permissionHelper');

// Load environment variables
dotenv.config();

const testPermissions = async () => {
  try {
    // Connect to database
    const mongoURI = process.env.MONGODB_URI;
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB successfully');

    // Find a user with super admin permission
    const superAdminUser = await User.findOne()
      .populate('permissions')
      .where('permissions').in(
        await Permission.findOne({ name: 'super_admin' }).select('_id')
      );

    if (!superAdminUser) {
      console.log('❌ No super admin user found');
      return;
    }

    console.log(`\n🧪 Testing permissions for user: ${superAdminUser.email}`);
    console.log(`📋 User permissions:`, superAdminUser.permissions.map(p => p.name));

    // Test super admin check
    console.log(`\n🔍 Is Super Admin: ${isSuperAdmin(superAdminUser)}`);

    // Test individual permission checks
    const testPermissions = [
      'quotation_view',
      'quotation_create', 
      'quotation_edit',
      'quotation_delete',
      'approve_rfq',
      'quotation_requester',
      'all_quotation_viewer'
    ];

    console.log('\n🔍 Testing individual permissions:');
    for (const permission of testPermissions) {
      const hasIt = hasPermission(superAdminUser, permission);
      console.log(`  ${permission}: ${hasIt ? '✅' : '❌'}`);
    }

    // Test any permission check
    console.log('\n🔍 Testing any permission check:');
    const hasAnyQuotationPermission = hasAnyPermission(superAdminUser, ['quotation_view', 'quotation_create']);
    console.log(`  Has any quotation permission: ${hasAnyQuotationPermission ? '✅' : '❌'}`);

    // Test all user permissions
    console.log('\n🔍 All user permissions:');
    const allPermissions = getAllUserPermissions(superAdminUser);
    console.log(`  Total permissions: ${allPermissions.length}`);
    console.log(`  Permissions: ${allPermissions.slice(0, 10).join(', ')}${allPermissions.length > 10 ? '...' : ''}`);

    // Test with a regular user (if exists)
    const regularUser = await User.findOne()
      .populate('permissions')
      .where('permissions').nin(
        await Permission.findOne({ name: 'super_admin' }).select('_id')
      );

    if (regularUser) {
      console.log(`\n🧪 Testing permissions for regular user: ${regularUser.email}`);
      console.log(`📋 User permissions:`, regularUser.permissions.map(p => p.name));
      
      console.log(`\n🔍 Is Super Admin: ${isSuperAdmin(regularUser)}`);
      
      console.log('\n🔍 Testing individual permissions:');
      for (const permission of testPermissions) {
        const hasIt = hasPermission(regularUser, permission);
        console.log(`  ${permission}: ${hasIt ? '✅' : '❌'}`);
      }
    }

    console.log('\n🎉 Permission testing completed!');

  } catch (error) {
    console.error('❌ Error testing permissions:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
};

// Run the test
testPermissions().catch(console.error);
