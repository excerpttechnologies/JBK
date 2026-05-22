function buildBranchQuery(user, queryBranchId) {
  if (!user) return {};

  const roles = Array.isArray(user.roles)
    ? user.roles
    : user.role
      ? [user.role]
      : [];

  const normalized = roles
    .map((role) => String(role || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  if ((normalized.includes('subadmin') || normalized.includes('branchadmin')) && user.branchId) {
    return { branchId: user.branchId };
  }

  if (queryBranchId) {
    return { branchId: queryBranchId };
  }

  return {};
}

function buildDateRange(createdAtFrom, createdAtTo) {
  const dateQuery = {};
  if (createdAtFrom) {
    dateQuery.$gte = new Date(createdAtFrom);
  }
  if (createdAtTo) {
    dateQuery.$lte = new Date(createdAtTo);
  }
  return Object.keys(dateQuery).length ? { createdAt: dateQuery } : {};
}

async function getDashboardSummary({ Enquiry, Registration, Faculty, branchId, dateFrom, dateTo }) {
  const query = { ...(branchId ? { branchId } : {}) };
  const dateFilter = buildDateRange(dateFrom, dateTo);
  if (dateFilter.createdAt) Object.assign(query, dateFilter);

  // const [totalEnquiries, assignedEnquiries, unassignedEnquiries, totalStudents, totalStaff, recentEnquiries] = await Promise.all([
  //   Enquiry.countDocuments(query),
  //   Enquiry.countDocuments({ ...query, status: 'assigned' }),
  //   Enquiry.countDocuments({ ...query, status: { $in: ['unassigned', 'pending', 'new'] } }),
  //   Registration.countDocuments(query),
  //   Faculty.countDocuments({ ...(branchId ? { branchId } : {}) }),
  //   Enquiry.find(query)
  //     .select('firstname lastname mobileNumber status createdAt assignedTo branchId')
  //     .sort({ createdAt: -1 })
  //     .limit(10)
  //     .lean(),
  // ]);



  const [totalEnquiries, assignedEnquiries, unassignedEnquiries, totalStudents, totalStaff, recentEnquiries] = await Promise.all([
  Enquiry.countDocuments(query),

  Enquiry.countDocuments({
    ...query,
    status: 'assigned'
  }),

Enquiry.countDocuments({
  ...query,
  "followUps.0": { $exists: true },
  status: {
    $nin: [
      "ConvertedtoWalkin",
      "ReadytoJoin",
      "Joined"
    ]
  }
}),

  Registration.countDocuments(query),

  Faculty.countDocuments({
    ...(branchId ? { branchId } : {})
  }),

  Enquiry.find(query)
    .select('firstname lastname mobileNumber status createdAt assignedTo branchId followUps')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean(),
]);
  return {
    totalEnquiries,
    assignedEnquiries,
    unassignedEnquiries,
    totalStudents,
    totalStaff,
    recentEnquiries,
  };
}

async function getDashboardEnquiries({ Enquiry, branchId, status, dateFrom, dateTo, page, limit }) {
  const query = { ...(branchId ? { branchId } : {}) };
  if (status) query.status = status;
  Object.assign(query, buildDateRange(dateFrom, dateTo));

  const offset = Math.max(0, (page - 1) * limit);
  const [enquiries, total] = await Promise.all([
    Enquiry.find(query)
      .select('firstname lastname mobileNumber status assignedTo createdAt branchId followUps')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    Enquiry.countDocuments(query),
  ]);

  return { enquiries, total };
}

module.exports = {
  buildBranchQuery,
  getDashboardSummary,
  getDashboardEnquiries,
};
