const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const { use } = require('../routes/auth');

// Hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

// Compare password
const comparePassword = async (candidatePassword, hashedPassword) => {
  try {
    console.log('Comparing password...');
    console.log('Candidate password:', candidatePassword);
    console.log('Hashed password:', hashedPassword);
    
    if (!candidatePassword) {
      throw new Error('Candidate password is required');
    }
    
    if (!hashedPassword) {
      throw new Error('Hashed password is required');
    }
    
    const result = await bcrypt.compare(candidatePassword, hashedPassword);
    console.log('Password comparison result:', result);
    return result;
  } catch (error) {
    console.error('Error in comparePassword:', error);
    throw error;
  }
};

// Validate email format
const validateEmail = (email) => {
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  return emailRegex.test(email);
};

// Validate password strength
const validatePassword = (password) => {
  if (!password || password.length < 6) {
    return { isValid: false, message: 'Password must be at least 6 characters long' };
  }
  return { isValid: true };
};

// Create user
const createUser = async (userData) => {
  const { email, password, fullName, phoneNumbers, permissions } = userData;

  // Validate email
  if (!validateEmail(email)) {
    throw new Error('Please enter a valid email');
  }

  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    throw new Error(passwordValidation.message);
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error('User already exists with this email');
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user
  const user = new User({
    email,
    password: hashedPassword,
    fullName: fullName || email.split('@')[0], // Use email prefix as default name
    phoneNumbers: phoneNumbers || [],
    permissions: permissions || [], // Use permissions array instead of roles
    isActive: true
  });

  await user.save();

  // Return user without password
  const userResponse = user.toObject();
  delete userResponse.password;
  return userResponse;
};

// Authenticate user
const authenticateUser = async (email, password) => {
  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Check if user is active
  if (!user.isActive) {
    throw new Error('Account is deactivated');
  }

  // Compare password
  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }



  // Return user without password
  const userResponse = user.toObject();
  delete userResponse.password;
  return userResponse;
};

// Get user by ID
const getUserById = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Return user without password
  const userResponse = user.toObject();
  delete userResponse.password;
  return userResponse;
};

// Update user
const updateUser = async (userId, updateData) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // If password is being updated, hash it
  if (updateData.password) {
    const passwordValidation = validatePassword(updateData.password);
    if (!passwordValidation.isValid) {
      throw new Error(passwordValidation.message);
    }
    updateData.password = await hashPassword(updateData.password);
  }

  // If email is being updated, validate it
  if (updateData.email) {
    if (!validateEmail(updateData.email)) {
      throw new Error('Please enter a valid email');
    }
    
    // Check if email is already taken by another user
    const existingUser = await User.findOne({ 
      email: updateData.email, 
      _id: { $ne: userId } 
    });
    if (existingUser) {
      throw new Error('Email is already taken');
    }
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    updateData,
    { new: true, runValidators: true }
  );

  // Return user without password
  const userResponse = updatedUser.toObject();
  delete userResponse.password;
  return userResponse;
};

// Delete user
const deleteUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  await User.findByIdAndDelete(userId);
  return { message: 'User deleted successfully' };
};

// Get all users
const getAllUsers = async (page = 1, limit = 10) => {
  console.log('getAllUsers called with page:', page, 'limit:', limit);
  
  const users = await User.find()
    .populate('permissions')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await User.countDocuments();
  
  console.log('Total users in database:', total);
  console.log('Users found:', users.length);

  // Remove passwords from all users and format roles
  const usersWithoutPasswords = users.map(user => {
    const userObj = user.toObject();
    delete userObj.password;
    
    // Format roles for frontend
    if (userObj.roles) {
      userObj.roles = userObj.roles.map(role => ({
        id: role._id,
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions
      }));
    }
    
    return userObj;
  });

  return {
    users: usersWithoutPasswords,
    pagination: {
      current: parseInt(page),
      pages: Math.ceil(total / limit),
      total
    }
  };
};

// Change password
const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Validate current password
  const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  // Validate new password
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    throw new Error(passwordValidation.message);
  }

  // Hash new password
  const hashedNewPassword = await hashPassword(newPassword);

  // Update password
  await User.findByIdAndUpdate(userId, { password: hashedNewPassword });

  return { message: 'Password changed successfully' };
};

module.exports = {
  createUser,
  authenticateUser,
  getUserById,
  updateUser,
  deleteUser,
  getAllUsers,
  changePassword,
  validateEmail,
  validatePassword,
  hashPassword,
  comparePassword
};
