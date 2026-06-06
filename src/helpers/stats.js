const { weapons, repairs, repairApprovals, APPROVAL_STATUS, maintenancePlans, maintenanceLogs, reminders, borrowRecords, daysBetween } = require('../store');

const MAINTENANCE_SUCCESS_RESULTS = ['success', '完成', '成功', 'completed', '已完成', '正常'];

function calcRate(numerator, denominator, defaultValue = 100, precision = 2) {
  if (!denominator || denominator <= 0) return defaultValue;
  const factor = Math.pow(10, precision + 2);
  return Math.round((numerator / denominator) * factor) / Math.pow(10, precision);
}

function isMaintenanceSuccess(result) {
  return MAINTENANCE_SUCCESS_RESULTS.includes(String(result || '').toLowerCase());
}

function countByField(list, field, value) {
  return list.filter(item => item[field] === value).length;
}

function countByStatus(list, statusEnum) {
  const counts = {};
  for (const key of Object.keys(statusEnum)) {
    counts[key] = 0;
  }
  for (const item of list) {
    for (const [key, val] of Object.entries(statusEnum)) {
      if (item.status === val) {
        counts[key] += 1;
        break;
      }
    }
  }
  return counts;
}

function distributionByField(list, field, includeDetails = false) {
  const dist = {};
  list.forEach(item => {
    const key = item[field];
    if (!dist[key]) {
      dist[key] = includeDetails ? { count: 0, items: [] } : { count: 0 };
    }
    dist[key].count += 1;
    if (includeDetails) {
      dist[key].items.push(item);
    }
  });
  return dist;
}

function distributionWithPercentage(list, field, itemMapper) {
  const dist = distributionByField(list, field, true);
  const total = list.length;
  return Object.keys(dist).map(key => {
    const entry = {
      [field]: key,
      count: dist[key].count,
      percentage: total > 0 ? calcRate(dist[key].count, total, 0) : 0
    };
    if (itemMapper) {
      entry.items = dist[key].items.map(itemMapper);
    }
    return entry;
  }).sort((a, b) => b.count - a.count);
}

function groupByTime(list, dateField, groupBy = 'month') {
  const dist = {};
  list.forEach(item => {
    const d = new Date(item[dateField]);
    let key;
    if (groupBy === 'year') {
      key = `${d.getFullYear()}`;
    } else if (groupBy === 'day') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    dist[key] = (dist[key] || 0) + 1;
  });
  return Object.keys(dist).sort().map(k => ({ period: k, count: dist[k] }));
}

function approvalStatusCounts(approvalList) {
  const counts = countByStatus(approvalList, APPROVAL_STATUS);
  const approved = counts.APPROVED || 0;
  const rejected = counts.REJECTED || 0;
  const decided = approved + rejected;
  return {
    total: approvalList.length,
    pendingPlan: counts.PENDING_PLAN || 0,
    pendingApproval: counts.PENDING_APPROVAL || 0,
    approved,
    rejected,
    decided,
    passRate: calcRate(approved, decided)
  };
}

function repairStatusCounts(repairList) {
  const completed = countByField(repairList, 'status', 'completed');
  const inProgress = countByField(repairList, 'status', 'in_progress');
  return {
    total: repairList.length,
    completed,
    inProgress
  };
}

function maintenanceOverview() {
  const planList = Array.from(maintenancePlans.values());
  const logList = Array.from(maintenanceLogs.values());
  const reminderList = Array.from(reminders.values());

  const totalPlans = planList.length;
  const totalLogs = logList.length;
  const successfulLogs = logList.filter(l => isMaintenanceSuccess(l.result)).length;

  const executionCompletionRate = totalPlans > 0
    ? calcRate(totalLogs, totalPlans)
    : totalLogs > 0 ? 100 : 100;

  const maintenanceReminders = reminderList.filter(
    r => r.type === 'maintenance' || r.type === 'maintenance_overdue'
  );
  const acknowledged = maintenanceReminders.filter(r => r.acknowledged).length;

  return {
    totalPlans,
    totalLogs,
    successfulLogs,
    executionCompletionRate,
    totalReminders: maintenanceReminders.length,
    acknowledged,
    responseRate: calcRate(acknowledged, maintenanceReminders.length)
  };
}

function borrowOverview() {
  const list = Array.from(borrowRecords.values());
  const returned = list.filter(b => b.status === 'returned');
  const active = list.filter(b => b.status === 'borrowed');
  const onTime = returned.filter(b => new Date(b.actualReturnDate) <= new Date(b.expectedReturnDate));

  return {
    total: list.length,
    returned: returned.length,
    active: active.length,
    onTimeReturns: onTime.length,
    returnOnTimeRate: calcRate(onTime.length, returned.length)
  };
}

function weaponsOverview() {
  const list = Array.from(weapons.values());
  return {
    total: list.length,
    statusStats: distributionByField(list, 'status'),
    eraDistribution: distributionByField(list, 'era'),
    materialDistribution: distributionByField(list, 'material')
  };
}

function aggregateByKey(list, keyFn, accumulator) {
  const map = {};
  list.forEach(item => {
    const key = keyFn(item);
    if (!map[key]) {
      map[key] = accumulator.init(item);
    } else {
      accumulator.accumulate(map[key], item);
    }
  });
  return Object.values(map);
}

function topByCount(list, keyFn, limit = 20, extraFieldsFn) {
  const counts = {};
  list.forEach(item => {
    const key = keyFn(item);
    if (!counts[key]) {
      counts[key] = extraFieldsFn ? { ...extraFieldsFn(item), count: 0 } : { key, count: 0 };
    }
    counts[key].count += 1;
  });
  return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, limit);
}

module.exports = {
  MAINTENANCE_SUCCESS_RESULTS,
  calcRate,
  isMaintenanceSuccess,
  countByField,
  countByStatus,
  distributionByField,
  distributionWithPercentage,
  groupByTime,
  approvalStatusCounts,
  repairStatusCounts,
  maintenanceOverview,
  borrowOverview,
  weaponsOverview,
  aggregateByKey,
  topByCount
};
