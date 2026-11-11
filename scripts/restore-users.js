const { connectToDatabase } = require('../lib/mongodb');
const User = require('../models/User');
const Group = require('../models/Group');

async function restoreUsersAndGroups() {
  await connectToDatabase();
  console.log('Connected to MongoDB Atlas.');

  const usersToRestore = [
    {
      _id: '6add30cb570ece1b3369f4ec',
      name: 'Zubair Mohammed',
      email: 'mdzubair7592@gmail.com',
      role: 'super_admin',
      isSuperAdmin: true,
      isEmailVerified: true,
      authProviders: ['email', 'google'],
      avatarUrl: 'https://lh3.googleusercontent.com/a/ACg8ocJ2PAVzvTP-cL2xVEx090d1rhzVaRLoiMesc77sZ005LMzpD6rPEA=s96-c',
      defaultCurrency: 'INR',
      upiId: ''
    },
    {
      _id: '6add3022570ece1b3369f4d5',
      name: 'Pencil',
      email: 'mrzoromit3@gmail.com',
      role: 'user',
      isSuperAdmin: false,
      isEmailVerified: true,
      authProviders: ['email', 'google'],
      defaultCurrency: 'INR',
      upiId: ''
    },
    {
      _id: '6ad3eb3175c56d3d6ec2e6ce',
      name: 'Sikander',
      email: 'mrzoromit2@gmail.com',
      role: 'user',
      isSuperAdmin: false,
      isEmailVerified: true,
      authProviders: ['email'],
      defaultCurrency: 'INR',
      upiId: ''
    },
    {
      name: 'SRI RAM PRANEETH SANAGAPALLI',
      email: 'praneethssr.2002@gmail.com',
      role: 'user',
      isSuperAdmin: false,
      isEmailVerified: true,
      authProviders: ['email'],
      defaultCurrency: 'INR',
      upiId: ''
    }
  ];

  for (const u of usersToRestore) {
    const existing = await User.findOne({ email: u.email });
    if (!existing) {
      await User.create(u);
      console.log('Restored user:', u.name, '(' + u.email + ')', 'role:', u.role);
    } else {
      console.log('User already exists:', u.email);
    }
  }

  // Restore Group 'Animal park'
  const existingGroup = await Group.findOne({ inviteCode: 'SPL-DE81B4' });
  if (!existingGroup) {
    const groupDoc = {
      _id: '6add3052570ece1b3369f4e0',
      name: 'Animal park',
      description: '',
      category: 'Home',
      currency: 'INR',
      inviteCode: 'SPL-DE81B4',
      createdByEmail: 'mrzoromit3@gmail.com',
      adminEmail: 'mrzoromit3@gmail.com',
      splitsVisibility: 'personal_only',
      minimizeDebts: true,
      adminHubSettlement: false,
      isArchived: false,
      members: [
        { name: 'Pencil', email: 'mrzoromit3@gmail.com', role: 'admin', defaultWeight: 1, upiId: '' },
        { name: 'Zubair Mohammed', email: 'mdzubair7592@gmail.com', role: 'member', defaultWeight: 1, upiId: '' },
        { name: 'Sikander', email: 'mrzoromit2@gmail.com', role: 'member', defaultWeight: 1, upiId: '' },
        { name: 'Praneeth', email: 'praneethssr.2002@gmail.com', role: 'member', defaultWeight: 1, upiId: '' }
      ]
    };
    await Group.create(groupDoc);
    console.log('Restored group:', groupDoc.name, 'with 4 members.');
  } else {
    console.log('Group Animal park already exists.');
  }

  const allUsers = await User.find({}, 'name email role isSuperAdmin isEmailVerified passwordRaw passwordHash').lean();
  console.log('All Users in DB now count:', allUsers.length);
  for (const u of allUsers) {
    console.log(' - User:', u.name, '(' + u.email + ')', 'role:', u.role, 'isSuperAdmin:', u.isSuperAdmin);
  }

  const allGroups = await Group.find({}, 'name members inviteCode').lean();
  console.log('All Groups in DB count:', allGroups.length);
  for (const g of allGroups) {
    console.log(' - Group:', g.name, 'members:', g.members.map(m => m.name + ' <' + m.email + '>').join(', '));
  }

  process.exit(0);
}

restoreUsersAndGroups().catch(err => {
  console.error('Error during restore:', err);
  process.exit(1);
});
