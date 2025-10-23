const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/user.model');
const Permission = require('../models/permission.model');
const { hasPermission } = require('../utils/permissionHelper');

// Load environment variables
dotenv.config();

const testRFQPermissions = async () => {
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

    console.log(`\n🧪 Testing RFQ permissions for super admin: ${superAdminUser.email}`);
    console.log(`📋 User permissions:`, superAdminUser.permissions.map(p => p.name));

    // Test all RFQ-related permissions
    const rfqPermissions = [
      'approve_rfq',
      'quotation_create', 
      'quotation_requester'
    ];

    console.log('\n🔍 Testing RFQ permissions:');
    for (const permission of rfqPermissions) {
      const hasIt = hasPermission(superAdminUser, permission);
      console.log(`  ${permission}: ${hasIt ? '✅' : '❌'}`);
    }

    // Test the specific logic from RFQ route
    console.log('\n🔍 Testing RFQ route logic:');
    const canApprove = hasPermission(superAdminUser, 'approve_rfq');
    const canCreateQuotation = hasPermission(superAdminUser, 'quotation_create');
    const canRequestQuotation = hasPermission(superAdminUser, 'quotation_requester');
    
    console.log(`  canApprove: ${canApprove}`);
    console.log(`  canCreateQuotation: ${canCreateQuotation}`);
    console.log(`  canRequestQuotation: ${canRequestQuotation}`);
    
    // Determine user role (from RFQ route logic)
    let userRole = 'viewer';
    if (canApprove) {
      userRole = 'approver';
    } else if (canCreateQuotation) {
      userRole = 'creator';
    } else if (canRequestQuotation) {
      userRole = 'requester';
    }
    
    console.log(`  User role: ${userRole}`);
    
    if (userRole === 'viewer') {
      console.log('  ❌ Super admin would get "Access denied" error!');
    } else {
      console.log('  ✅ Super admin has proper access');
    }

    // Test with a regular user (if exists)
    const regularUser = await User.findOne()
      .populate('permissions')
      .where('permissions').nin(
        await Permission.findOne({ name: 'super_admin' }).select('_id')
      );

    if (regularUser) {
      console.log(`\n🧪 Testing RFQ permissions for regular user: ${regularUser.email}`);
      console.log(`📋 User permissions:`, regularUser.permissions.map(p => p.name));
      
      console.log('\n🔍 Testing RFQ permissions:');
      for (const permission of rfqPermissions) {
        const hasIt = hasPermission(regularUser, permission);
        console.log(`  ${permission}: ${hasIt ? '✅' : '❌'}`);
      }
      
      // Test the specific logic from RFQ route
      console.log('\n🔍 Testing RFQ route logic:');
      const canApprove = hasPermission(regularUser, 'approve_rfq');
      const canCreateQuotation = hasPermission(regularUser, 'quotation_create');
      const canRequestQuotation = hasPermission(regularUser, 'quotation_requester');
      
      console.log(`  canApprove: ${canApprove}`);
      console.log(`  canCreateQuotation: ${canCreateQuotation}`);
      console.log(`  canRequestQuotation: ${canRequestQuotation}`);
      
      // Determine user role (from RFQ route logic)
      let userRole = 'viewer';
      if (canApprove) {
        userRole = 'approver';
      } else if (canCreateQuotation) {
        userRole = 'creator';
      } else if (canRequestQuotation) {
        userRole = 'requester';
      }
      
      console.log(`  User role: ${userRole}`);
      
      if (userRole === 'viewer') {
        console.log('  ❌ Regular user would get "Access denied" error!');
      } else {
        console.log('  ✅ Regular user has proper access');
      }
    }

    console.log('\n🎉 RFQ permission testing completed!');

  } catch (error) {
    console.error('❌ Error testing RFQ permissions:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
};

// Run the test
testRFQPermissions().catch(console.error);
