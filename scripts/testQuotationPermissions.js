const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/user.model');
const Permission = require('../models/permission.model');

// Load environment variables
dotenv.config();

const testQuotationPermissions = async () => {
  try {
    // Connect to database
    const mongoURI = process.env.MONGODB_URI;
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB successfully');

    // Find super admin user
    const superAdminUser = await User.findOne()
      .populate('permissions')
      .where('permissions').in(
        await Permission.findOne({ name: 'super_admin' }).select('_id')
      );

    if (!superAdminUser) {
      console.log('❌ No super admin user found');
      return;
    }

    console.log(`\n🧪 Testing quotation permissions for super admin: ${superAdminUser.email}`);
    console.log(`📋 User permissions:`, superAdminUser.permissions.map(p => p.name));

    // Test all quotation-related permissions that frontend checks
    const quotationPermissions = [
      'quotation_view',
      'quotation_create', 
      'quotation_edit',
      'quotation_delete',
      'approve_rfq',
      'quotation_requester',
      'all_quotation_viewer',
      'quotation_admin',
      'admin'
    ];

    console.log('\n🔍 Testing quotation permissions:');
    for (const permission of quotationPermissions) {
      // Simulate the permission check logic from auth.js
      let hasPermission = false;
      
      // Check for super admin permission first
      const hasSuperAdmin = superAdminUser.permissions.some(p => p.name === 'super_admin');
      if (hasSuperAdmin) {
        hasPermission = true;
      } else {
        // Check individual permissions and multi-permissions
        const userPermissions = [];
        superAdminUser.permissions.forEach(userPermission => {
          if (userPermission.type === 'individual') {
            userPermissions.push(userPermission.name);
          } else if (userPermission.type === 'multi' && userPermission.includes) {
            // Multi-permission includes multiple individual permissions
            userPermissions.push(...userPermission.includes);
          }
        });
        
        hasPermission = userPermissions.includes(permission);
      }
      
      console.log(`  ${permission}: ${hasPermission ? '✅' : '❌'}`);
    }

    // Test with a regular user (if exists)
    const regularUser = await User.findOne()
      .populate('permissions')
      .where('permissions').nin(
        await Permission.findOne({ name: 'super_admin' }).select('_id')
      );

    if (regularUser) {
      console.log(`\n🧪 Testing quotation permissions for regular user: ${regularUser.email}`);
      console.log(`📋 User permissions:`, regularUser.permissions.map(p => p.name));
      
      console.log('\n🔍 Testing quotation permissions:');
      for (const permission of quotationPermissions) {
        // Simulate the permission check logic from auth.js
        let hasPermission = false;
        
        // Check for super admin permission first
        const hasSuperAdmin = regularUser.permissions.some(p => p.name === 'super_admin');
        if (hasSuperAdmin) {
          hasPermission = true;
        } else {
          // Check individual permissions and multi-permissions
          const userPermissions = [];
          regularUser.permissions.forEach(userPermission => {
            if (userPermission.type === 'individual') {
              userPermissions.push(userPermission.name);
            } else if (userPermission.type === 'multi' && userPermission.includes) {
              // Multi-permission includes multiple individual permissions
              userPermissions.push(...userPermission.includes);
            }
          });
          
          hasPermission = userPermissions.includes(permission);
        }
        
        console.log(`  ${permission}: ${hasPermission ? '✅' : '❌'}`);
      }
    }

    console.log('\n🎉 Quotation permission testing completed!');

  } catch (error) {
    console.error('❌ Error testing quotation permissions:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
};

// Run the test
testQuotationPermissions().catch(console.error);
