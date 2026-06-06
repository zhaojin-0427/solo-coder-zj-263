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
const { filterByDateRange } = require('../helpers/query');
const {
  calcRate,
  isMaintenanceSuccess,
  approvalStatusCounts,
  repairStatusCounts,
  maintenanceOverview,
  borrowOverview,
  weaponsOverview,
  distributionWithPercentage,
  groupByTime,
  topByCount
} = require('../helpers/stats');

const router = express.Router();

router.get('/overview', (req, res) => {
  const repairList = Array.from(repairs.values());
  const approvalList = Array.from(repairApprovals.values());

  const wStats = weaponsOverview();
  const rStats = repairStatusCounts(repairList);
  const aStats = approvalStatusCounts(approvalList);
  const mStats = maintenanceOverview();
  const bStats = borrowOverview();

  return res.success({
    totalWeapons: wStats.total,
    statusStats: wStats.statusStats,
    eraDistribution: wStats.eraDistribution,
    materialDistribution: wStats.materialDistribution,
    repair: {
      total: rStats.total,
      completed: rStats.completed,
      inProgress: rStats.inProgress
    },
    approval: {
      total: aStats.total,
      pendingPlan: aStats.pendingPlan,
      pendingApproval: aStats.pendingApproval,
      approved: aStats.approved,
      rejected: aStats.rejected,
      passRate: aStats.passRate
    },
    maintenance: {
      totalPlans: mStats.totalPlans,
      totalLogs: mStats.totalLogs,
      successfulLogs: mStats.successfulLogs,
      executionCompletionRate: mStats.executionCompletionRate,
      totalReminders: mStats.totalReminders,
      acknowledged: mStats.acknowledged,
      responseRate: mStats.responseRate
    },
    borrow: {
      total: bStats.total,
      returned: bStats.returned,
      active: bStats.active,
      onTimeReturns: bStats.onTimeReturns,
      returnOnTimeRate: bStats.returnOnTimeRate
    }
  });
});

router.get('/era-distribution', (req, res) => {
  const weaponList = Array.from(weapons.values());
  const total = weaponList.length;
  const list = distributionWithPercentage(
    weaponList,
    'era',
    w => ({ id: w.id, name: w.name, status: w.status })
  ).map(item => ({
    era: item.era,
    count: item.count,
    percentage: item.percentage,
    weapons: item.items
  }));

  return res.success({ total, list });
});

router.get('/repair-frequency', (req, res) => {
  const { startDate, endDate, groupBy = 'month' } = req.query;

  let repairList = Array.from(repairs.values()).filter(r => r.status === 'completed');
  repairList = filterByDateRange(repairList, 'completedAt', startDate, endDate);

  const topWeapons = topByCount(
    repairList,
    r => r.weaponId,
    20,
    r => {
      const w = weapons.get(r.weaponId);
      return {
        weaponId: r.weaponId,
        weaponName: w ? w.name : '未知',
        era: w ? w.era : '未知'
      };
    }
  );

  const timeDistribution = groupByTime(repairList, 'completedAt', groupBy);

  const topRestorers = topByCount(
    repairList,
    r => r.restorer.name || '未知',
    10,
    r => ({ name: r.restorer.name || '未知' })
  );

  return res.success({
    totalCompleted: repairList.length,
    topWeapons,
    timeDistribution,
    topRestorers
  });
});

router.get('/maintenance-response-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let allReminders = Array.from(reminders.values()).filter(
    r => r.type === 'maintenance' || r.type === 'maintenance_overdue'
  );
  allReminders = filterByDateRange(allReminders, 'createdAt', startDate, endDate);

  const total = allReminders.length;
  const acknowledged = allReminders.filter(r => r.acknowledged).length;
  const responseRate = calcRate(acknowledged, total);

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
    byType[t].responseRate = calcRate(byType[t].acknowledged, byType[t].total);
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
    w.responseRate = calcRate(w.acknowledged, w.total);
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
  approvalList = filterByDateRange(approvalList, 'appliedAt', startDate, endDate);

  const counts = approvalStatusCounts(approvalList);

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
    x.passRate = calcRate(x.approved, x.approved + x.rejected);
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
    w.passRate = calcRate(w.approved, w.approved + w.rejected);
  });

  return res.success({
    total: counts.total,
    pendingPlan: counts.pendingPlan,
    pendingApproval: counts.pendingApproval,
    approved: counts.approved,
    rejected: counts.rejected,
    decided: counts.decided,
    passRate: counts.passRate,
    byApplicant: Object.values(byApplicant).sort((a, b) => b.total - a.total).slice(0, 20),
    byWeapon: Object.values(byWeapon).sort((a, b) => b.total - a.total).slice(0, 20)
  });
});

router.get('/maintenance-completion-rate', (req, res) => {
  const { startDate, endDate } = req.query;

  let logList = Array.from(maintenanceLogs.values());
  logList = filterByDateRange(logList, 'executedAt', startDate, endDate);

  const totalPlans = maintenancePlans.size;
  const totalLogs = logList.length;
  const successfulLogs = logList.filter(l => isMaintenanceSuccess(l.result)).length;
  const completionRate = totalPlans > 0
    ? calcRate(totalLogs, totalPlans)
    : totalLogs > 0 ? 100 : 100;
  const successRate = calcRate(successfulLogs, totalLogs);

  const byOperator = {};
  logList.forEach(l => {
    const name = l.operator || '未知';
    if (!byOperator[name]) {
      byOperator[name] = { operator: name, total: 0, successful: 0, successRate: 0 };
    }
    byOperator[name].total += 1;
    if (isMaintenanceSuccess(l.result)) byOperator[name].successful += 1;
  });
  Object.values(byOperator).forEach(x => {
    x.successRate = calcRate(x.successful, x.total);
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
    if (isMaintenanceSuccess(l.result)) byWeapon[l.weaponId].successful += 1;
  });
  Object.values(byWeapon).forEach(w => {
    w.successRate = calcRate(w.successful, w.total);
  });

  const byMethod = {};
  logList.forEach(l => {
    const method = l.executionMethod || '未知';
    if (!byMethod[method]) {
      byMethod[method] = { method, total: 0, successful: 0, successRate: 0 };
    }
    byMethod[method].total += 1;
    if (isMaintenanceSuccess(l.result)) byMethod[method].successful += 1;
  });
  Object.values(byMethod).forEach(m => {
    m.successRate = calcRate(m.successful, m.total);
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
  borrowList = filterByDateRange(borrowList, 'borrowDate', startDate, endDate);

  const total = borrowList.length;
  const returned = borrowList.filter(b => b.status === 'returned');
  const active = borrowList.filter(b => b.status === 'borrowed');
  const onTime = returned.filter(b => new Date(b.actualReturnDate) <= new Date(b.expectedReturnDate));
  const overdue = returned.filter(b => new Date(b.actualReturnDate) > new Date(b.expectedReturnDate));

  const returnOnTimeRate = calcRate(onTime.length, returned.length);

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
    x.returnOnTimeRate = calcRate(x.onTime, x.returned);
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
