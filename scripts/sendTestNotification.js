const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Notification = require('../models/notification.model');
const User = require('../models/user.model');
const { addNotification } = require('../utils/notificationHelper');

dotenv.config();

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    const admin = await User.findOne({ email: 'admin@asb.com' });
    if (!admin) {
      console.error('No user found with email admin@asb.com');
      process.exit(1);
    }

    const notif = await addNotification({
      userId: admin._id,
      title: 'Test Notification',
      description: 'This is a test notification for admin@asb.com',
      path: '/profile'
    });

    console.log('Notification created:', {
      id: notif._id.toString(),
      userId: admin._id.toString(),
      title: notif.title,
      description: notif.description,
      link: notif.link,
      createdAt: notif.createdAt
    });
  } catch (e) {
    console.error('Error creating test notification:', e);
  } finally {
    await mongoose.disconnect();
  }
}

main();
