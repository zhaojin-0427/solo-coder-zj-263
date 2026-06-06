const express = require('express');
const {
  weapons,
  repairs,
  repairApprovals,
  APPROVAL_STATUS,
  maintenancePlans,
  maintenanceLogs,
  reminders,
  borrowRecords,
  daysBetween
} = require('../store');

const router = express.Router();

router.get('/overview', (req, res) => {
  const weaponList = Array.from(weapons.values());
  const repairList = Array.from(repairs.values());
  const borrowList = Array.from(borrowRecords.values());
  const reminderList = Array.from(reminders.values());
  const approvalList = Array.from(repairApprovals.values());
  const maintenanceLogList = Array.from(maintenanceLogs.values());

  const statusStats = {};
  weaponList.forEach(w => {
    statusStats[w.status] = (statusStats[w.status] || 0) + 1;
  });

  const eraDistribution = {};
  weaponList.forEach(w => {
    eraDistribution[w.era] = (eraDistribution[w.era] || 0) + 1;
  });

  const materialDistribution = {};
  weaponList.forEach(w => {
    materialDistribution[w.material] = (materialDistribution[w.material] || 0) + 1;
  });

  const repairCount = repairList.length;
  const completedRepairs = repairList.filter(r => r.status === 'completed').length;
  const pendingRepairs = repairList.filter(r => r.status === 'in_progress').length;

  const decidedApprovals = approvalList.filter(
    a => a.status === APPROVAL_STATUS.APPROVED || a.status === APPROVAL_STATUS.REJECTED
  );
  const approvedCount = approvalList.filter(a => a.status === APPROVAL_STATUS.APPROVED).length;
  const rejectedCount = approvalList.filter(a => a.status === APPROVAL_STATUS.REJECTED).length;
  const approvalPassRate = decidedApprovals.length > 0
    ? Math.round((approvedCount / decidedApprovals.length) * 10000) / 100
    : 100;

  const totalMaintenancePlans = maintenancePlans.size;
  const successfulMaintenanceLogs = maintenanceLogList.filter(l =>
    l.result === 'success' || l.result === '完成' || l.result === '成功' || l.result === 'completed'
  ).length;
  const maintenanceExecutionCompletionRate = totalMaintenancePlans > 0
    ? Math.round((maintenanceLogList.length / totalMaintenancePlans) * 10000) / 100
    : maintenanceLogList.length > 0 ? 100 : 100;

  const now = new Date();
  const maintenanceReminders = reminderList.filter(
    r => (r.type === 'maintenance' || r.type === 'maintenance_overdue')
  );
  const acknowledgedMaintenance = maintenanceReminders.filter(r => r.acknowledged).length;
  const maintenanceResponseRate = maintenanceReminders.length > 0
    ? Math.round((acknowledgedMaintenance / maintenanceReminders.length) * 10000) / 100
    : 100;

  const returnedBorrows = borrowList.filter(b => b.status === 'returned');
  const onTimeReturns = returnedBorrows.filter(b => {
    const actual = new Date(b.actualReturnDate);
    const expected = new Date(b.expectedReturnDate);
    return actual <= expected;
  }).length;
  const returnOnTimeRate = returnedBorrows.length > 0
    ? Math.round((onTimeReturns / returnedBorrows.length) * 10000) / 100
    : 100;

  const activeBorrows = borrowList.filter(b => b.status === 'borrowed').length;

  return res.success({
    totalWeapons: weaponList.length,
    statusStats,
    eraDistribution,
    materialDistribution,
    repair: {
      total: repairCount,
      completed: completedRepairs,
      inProgress: pendingRepairs
    },
    approval: {
      total: approvalList.length,
      pendingPlan: approvalList.filter(a => a.status === APPROVAL_STATUS.PENDING_PLAN).length,
      pendingApproval: approvalList.filter(a => a.status === APPROVAL_STATUS.PENDING_APPROVAL).length,
      approved: approvedCount,
      rejected: rejectedCount,
      passRate: approvalPassRate
    },
    maintenance: {
      totalPlans: totalMaintenancePlans,
      totalLogs: maintenanceLogList.length,
      successfulLogs: successfulMaintenanceLogs,
      executionCompletionRate: maintenanceExecutionCompletionRate,
      totalReminders: maintenanceReminders.length,
      acknowledged: acknowledgedMaintenance,
      responseRate: maintenanceResponseRate
    },
    borrow: {
      total: borrowList.length,
      returned: returnedBorrows.length,
      active: activeBorrows,
      onTimeReturns,
      returnOnTimeRate
    }
  });
});

router.get('/era-distribution', (req, res) => {
  const weaponList = Array.from(weapons.values());
  const eraDistribution = {};
  weaponList.forEach(w => {
    if (!eraDistribution[w.era]) {
      eraDistribution[w.era] = { count: 0, weapons: [] };
    }
    eraDistribution[w.era].count += 1;
    eraDistribution[w.era].weapons.push({ id: w.id, name: w.name, status: w.status });
  });

  const total = weaponList.length;
  const list = Object.keys(eraDistribution).map(era => ({
    era,
    count: eraDistribution[era].count,
    percentage: total > 0 ? Math.round((eraDistribution[era].count / total) * 10000) / 100 : 0,
    weapons: eraDistribution[era].weapons
  })).sort((a, b) => b.count - a.count);

  return res.success({ total, list });
});

router.get('/repair-frequency', (req, res) => {
  const { startDate, endDate, groupBy = 'month' } = req.query;

  const repairList = Array.from(repairs.values()).filter(r => r.status === 'completed');

  let filtered = repairList;
  if (startDate) {
    const sd = new Date(startDate);
    filtered = filtered.filter(r => new Date(r.completedAt) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    filtered = filtered.filter(r => new Date(r.completedAt) <= ed);
  }

  const weaponRepairCount = {};
  filtered.forEach(r => {
    if (!weaponRepairCount[r.weaponId]) {
      const w = weapons.get(r.weaponId);
      weaponRepairCount[r.weaponId] = {
        weaponId: r.weaponId,
        weaponName: w ? w.name : '未知',
        era: w ? w.era : '未知',
        count: 0
      };
    }
    weaponRepairCount[r.weaponId].count += 1;
  });

  const topWeapons = Object.values(weaponRepairCount).sort((a, b) => b.count - a.count).slice(0, 20);

  const timeDistribution = {};
  filtered.forEach(r => {
    const d = new Date(r.completedAt);
    let key;
    if (groupBy === 'year') {
      key = `${d.getFullYear()}`;
    } else if (groupBy === 'day') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    timeDistribution[key] = (timeDistribution[key] || 0) + 1;
  });

  const timeList = Object.keys(timeDistribution).sort().map(k => ({
    period: k,
    count: timeDistribution[k]
  }));

  const restorerCount = {};
  filtered.forEach(r => {
    const name = r.restorer.name || '未知';
    restorerCount[name] = (restorerCount[name] || 0) + 1;
  });
  const topRestorers = Object.entries(restorerCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return res.success({
    totalCompleted: filtered.length,
    topWeapons,
    timeDistribution: timeList,
    topRestorers
  });
});

router.get('/maintenance-response-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let allReminders = Array.from(reminders.values()).filter(
    r => r.type === 'maintenance' || r.type === 'maintenance_overdue'
  );

  if (startDate) {
    const sd = new Date(startDate);
    allReminders = allReminders.filter(r => new Date(r.createdAt) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    allReminders = allReminders.filter(r => new Date(r.createdAt) <= ed);
  }

  const total = allReminders.length;
  const acknowledged = allReminders.filter(r => r.acknowledged).length;
  const responseRate = total > 0 ? Math.round((acknowledged / total) * 10000) / 100 : 100;

  const now = new Date();
  const avgResponseDays = acknowledged > 0 ? Math.round(
    allReminders
      .filter(r => r.acknowledged)
      .reduce((sum, r) => sum + daysBetween(new Date(r.createdAt), new Date(r.acknowledgedAt)), 0)
    / acknowledged * 10
  ) / 10 : 0;

  const byType = {};
  allReminders.forEach(r => {
    if (!byType[r.type]) byType[r.type] = { total: 0, acknowledged: 0, responseRate: 0 };
    byType[r.type].total += 1;
    if (r.acknowledged) byType[r.type].acknowledged += 1;
  });
  Object.keys(byType).forEach(t => {
    byType[t].responseRate = byType[t].total > 0
      ? Math.round((byType[t].acknowledged / byType[t].total) * 10000) / 100 : 100;
  });

  const byWeapon = {};
  allReminders.forEach(r => {
    if (!byWeapon[r.weaponId]) {
      const w = weapons.get(r.weaponId);
      byWeapon[r.weaponId] = {
        weaponId: r.weaponId,
        weaponName: w ? w.name : '未知',
        total: 0,
        acknowledged: 0,
        responseRate: 0
      };
    }
    byWeapon[r.weaponId].total += 1;
    if (r.acknowledged) byWeapon[r.weaponId].acknowledged += 1;
  });
  Object.values(byWeapon).forEach(w => {
    w.responseRate = w.total > 0 ? Math.round((w.acknowledged / w.total) * 10000) / 100 : 100;
  });

  return res.success({
    total,
    acknowledged,
    responseRate,
    avgResponseDays,
    byType,
    byWeapon: Object.values(byWeapon).sort((a, b) => a.responseRate - b.responseRate).slice(0, 20)
  });
});

router.get('/approval-pass-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let approvalList = Array.from(repairApprovals.values());
  if (startDate) {
    const sd = new Date(startDate);
    approvalList = approvalList.filter(a => new Date(a.appliedAt) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    approvalList = approvalList.filter(a => new Date(a.appliedAt) <= ed);
  }

  const total = approvalList.length;
  const pendingPlan = approvalList.filter(a => a.status === APPROVAL_STATUS.PENDING_PLAN).length;
  const pendingApproval = approvalList.filter(a => a.status === APPROVAL_STATUS.PENDING_APPROVAL).length;
  const approved = approvalList.filter(a => a.status === APPROVAL_STATUS.APPROVED).length;
  const rejected = approvalList.filter(a => a.status === APPROVAL_STATUS.REJECTED).length;
  const decided = approved + rejected;
  const passRate = decided > 0 ? Math.round((approved / decided) * 10000) / 100 : 100;

  const byApplicant = {};
  approvalList.forEach(a => {
    const name = a.applicant?.name || '未知';
    if (!byApplicant[name]) {
      byApplicant[name] = { applicant: name, total: 0, approved: 0, rejected: 0, passRate: 0 };
    }
    byApplicant[name].total += 1;
    if (a.status === APPROVAL_STATUS.APPROVED) byApplicant[name].approved += 1;
    if (a.status === APPROVAL_STATUS.REJECTED) byApplicant[name].rejected += 1;
  });
  Object.values(byApplicant).forEach(x => {
    const d = x.approved + x.rejected;
    x.passRate = d > 0 ? Math.round((x.approved / d) * 10000) / 100 : 100;
  });

  const byWeapon = {};
  approvalList.forEach(a => {
    if (!byWeapon[a.weaponId]) {
      const w = weapons.get(a.weaponId);
      byWeapon[a.weaponId] = {
        weaponId: a.weaponId,
        weaponName: w ? w.name : '未知',
        total: 0,
        approved: 0,
        rejected: 0,
        passRate: 0
      };
    }
    byWeapon[a.weaponId].total += 1;
    if (a.status === APPROVAL_STATUS.APPROVED) byWeapon[a.weaponId].approved += 1;
    if (a.status === APPROVAL_STATUS.REJECTED) byWeapon[a.weaponId].rejected += 1;
  });
  Object.values(byWeapon).forEach(w => {
    const d = w.approved + w.rejected;
    w.passRate = d > 0 ? Math.round((w.approved / d) * 10000) / 100 : 100;
  });

  return res.success({
    total,
    pendingPlan,
    pendingApproval,
    approved,
    rejected,
    decided,
    passRate,
    byApplicant: Object.values(byApplicant).sort((a, b) => b.total - a.total).slice(0, 20),
    byWeapon: Object.values(byWeapon).sort((a, b) => b.total - a.total).slice(0, 20)
  });
});

router.get('/maintenance-completion-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let logList = Array.from(maintenanceLogs.values());
  if (startDate) {
    const sd = new Date(startDate);
    logList = logList.filter(l => new Date(l.executedAt) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    logList = logList.filter(l => new Date(l.executedAt) <= ed);
  }

  const totalPlans = maintenancePlans.size;
  const totalLogs = logList.length;
  const successResults = ['success', '完成', '成功', 'completed', '已完成', '正常'];
  const successfulLogs = logList.filter(l => successResults.includes(String(l.result).toLowerCase())).length;
  const completionRate = totalPlans > 0
    ? Math.round((totalLogs / totalPlans) * 10000) / 100
    : totalLogs > 0 ? 100 : 100;
  const successRate = totalLogs > 0
    ? Math.round((successfulLogs / totalLogs) * 10000) / 100
    : 100;

  const byOperator = {};
  logList.forEach(l => {
    const name = l.operator || '未知';
    if (!byOperator[name]) {
      byOperator[name] = { operator: name, total: 0, successful: 0, successRate: 0 };
    }
    byOperator[name].total += 1;
    if (successResults.includes(String(l.result).toLowerCase())) byOperator[name].successful += 1;
  });
  Object.values(byOperator).forEach(x => {
    x.successRate = x.total > 0 ? Math.round((x.successful / x.total) * 10000) / 100 : 100;
  });

  const byWeapon = {};
  logList.forEach(l => {
    if (!byWeapon[l.weaponId]) {
      const w = weapons.get(l.weaponId);
      byWeapon[l.weaponId] = {
        weaponId: l.weaponId,
        weaponName: w ? w.name : '未知',
        total: 0,
        successful: 0,
        successRate: 0
      };
    }
    byWeapon[l.weaponId].total += 1;
    if (successResults.includes(String(l.result).toLowerCase())) byWeapon[l.weaponId].successful += 1;
  });
  Object.values(byWeapon).forEach(w => {
    w.successRate = w.total > 0 ? Math.round((w.successful / w.total) * 10000) / 100 : 100;
  });

  const byMethod = {};
  logList.forEach(l => {
    const method = l.executionMethod || '未知';
    if (!byMethod[method]) {
      byMethod[method] = { method, total: 0, successful: 0, successRate: 0 };
    }
    byMethod[method].total += 1;
    if (successResults.includes(String(l.result).toLowerCase())) byMethod[method].successful += 1;
  });
  Object.values(byMethod).forEach(m => {
    m.successRate = m.total > 0 ? Math.round((m.successful / m.total) * 10000) / 100 : 100;
  });

  return res.success({
    totalPlans,
    totalLogs,
    successfulLogs,
    completionRate,
    successRate,
    byOperator: Object.values(byOperator).sort((a, b) => b.total - a.total).slice(0, 20),
    byWeapon: Object.values(byWeapon).sort((a, b) => b.total - a.total).slice(0, 20),
    byMethod: Object.values(byMethod).sort((a, b) => b.total - a.total).slice(0, 20)
  });
});

router.get('/borrow-return-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let borrowList = Array.from(borrowRecords.values());
  if (startDate) {
    const sd = new Date(startDate);
    borrowList = borrowList.filter(b => new Date(b.borrowDate) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    borrowList = borrowList.filter(b => new Date(b.borrowDate) <= ed);
  }

  const total = borrowList.length;
  const returned = borrowList.filter(b => b.status === 'returned');
  const active = borrowList.filter(b => b.status === 'borrowed');
  const onTime = returned.filter(b => new Date(b.actualReturnDate) <= new Date(b.expectedReturnDate));
  const overdue = returned.filter(b => new Date(b.actualReturnDate) > new Date(b.expectedReturnDate));

  const returnOnTimeRate = returned.length > 0
    ? Math.round((onTime.length / returned.length) * 10000) / 100 : 100;

  const avgOverdueDays = overdue.length > 0 ? Math.round(
    overdue.reduce((sum, b) => sum + daysBetween(
      new Date(b.expectedReturnDate),
      new Date(b.actualReturnDate)
    ), 0) / overdue.length * 10
  ) / 10 : 0;

  const byBorrower = {};
  borrowList.forEach(b => {
    if (!byBorrower[b.borrower]) {
      byBorrower[b.borrower] = {
        borrower: b.borrower,
        total: 0,
        returned: 0,
        onTime: 0,
        returnOnTimeRate: 0
      };
    }
    byBorrower[b.borrower].total += 1;
    if (b.status === 'returned') {
      byBorrower[b.borrower].returned += 1;
      if (new Date(b.actualReturnDate) <= new Date(b.expectedReturnDate)) {
        byBorrower[b.borrower].onTime += 1;
      }
    }
  });
  Object.values(byBorrower).forEach(x => {
    x.returnOnTimeRate = x.returned > 0
      ? Math.round((x.onTime / x.returned) * 10000) / 100 : 100;
  });

  const now = new Date();
  const currentlyOverdue = active.filter(b => now > new Date(b.expectedReturnDate));

  return res.success({
    total,
    returned: returned.length,
    active: active.length,
    onTime: onTime.length,
    overdue: overdue.length,
    returnOnTimeRate,
    avgOverdueDays,
    currentlyOverdue: currentlyOverdue.length,
    byBorrower: Object.values(byBorrower).sort((a, b) => b.total - a.total).slice(0, 20)
  });
});

module.exports = router;
