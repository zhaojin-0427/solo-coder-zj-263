const express = require('express');
const {
  STATUS,
  weapons,
  maintenancePlans,
  maintenanceLogs,
  reminders,
  borrowRecords,
  generateId,
  calculateMaintenanceDays,
  addDays,
  daysBetween
} = require('../store');

const router = express.Router();

function generateRemindersForAll() {
  const now = new Date();
  const reminderDaysAhead = 7;

  maintenancePlans.forEach((plan, weaponId) => {
    const nextDate = new Date(plan.nextMaintenanceDate);
    const daysToNext = daysBetween(now, nextDate);

    if (daysToNext <= reminderDaysAhead && daysToNext >= 0) {
      const existing = Array.from(reminders.values()).find(
        r => r.weaponId === weaponId && r.type === 'maintenance' && !r.acknowledged &&
          Math.abs(daysBetween(new Date(r.createdAt), now)) < 1
      );
      if (!existing) {
        const reminder = {
          id: generateId(),
          weaponId,
          type: 'maintenance',
          title: '养护到期提醒',
          content: `兵器养护将在 ${daysToNext} 天后到期`,
          dueDate: nextDate.toISOString(),
          daysRemaining: daysToNext,
          acknowledged: false,
          createdAt: now.toISOString()
        };
        reminders.set(reminder.id, reminder);
      }
    }

    if (daysToNext < 0) {
      const existing = Array.from(reminders.values()).find(
        r => r.weaponId === weaponId && r.type === 'maintenance_overdue' && !r.acknowledged
      );
      if (!existing) {
        const reminder = {
          id: generateId(),
          weaponId,
          type: 'maintenance_overdue',
          title: '养护逾期提醒',
          content: `兵器养护已逾期 ${Math.abs(daysToNext)} 天`,
          dueDate: nextDate.toISOString(),
          daysOverdue: Math.abs(daysToNext),
          acknowledged: false,
          createdAt: now.toISOString()
        };
        reminders.set(reminder.id, reminder);
      }
    }
  });

  borrowRecords.forEach(record => {
    if (record.status !== 'borrowed') return;
    const dueDate = new Date(record.expectedReturnDate);
    const daysToReturn = daysBetween(now, dueDate);

    if (daysToReturn <= 3 && daysToReturn >= 0) {
      const existing = Array.from(reminders.values()).find(
        r => r.weaponId === record.weaponId && r.type === 'borrow_return' && !r.acknowledged &&
          Math.abs(daysBetween(new Date(r.createdAt), now)) < 1
      );
      if (!existing) {
        const reminder = {
          id: generateId(),
          weaponId: record.weaponId,
          borrowRecordId: record.id,
          type: 'borrow_return',
          title: '外借归还提醒',
          content: `展览外借将在 ${daysToReturn} 天后到期，请按时归还`,
          dueDate: dueDate.toISOString(),
          daysRemaining: daysToReturn,
          acknowledged: false,
          createdAt: now.toISOString()
        };
        reminders.set(reminder.id, reminder);
      }
    }

    if (daysToReturn < 0) {
      const existing = Array.from(reminders.values()).find(
        r => r.weaponId === record.weaponId && r.type === 'borrow_overdue' && !r.acknowledged
      );
      if (!existing) {
        const reminder = {
          id: generateId(),
          weaponId: record.weaponId,
          borrowRecordId: record.id,
          type: 'borrow_overdue',
          title: '外借逾期提醒',
          content: `展览外借已逾期 ${Math.abs(daysToReturn)} 天，请尽快归还`,
          dueDate: dueDate.toISOString(),
          daysOverdue: Math.abs(daysToReturn),
          acknowledged: false,
          createdAt: now.toISOString()
        };
        reminders.set(reminder.id, reminder);
      }
    }
  });
}

router.get('/plans', (req, res) => {
  const { weaponId, material, environment, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(maintenancePlans.values());
  if (weaponId) list = list.filter(pl => pl.weaponId === weaponId);
  if (material) list = list.filter(pl => pl.material === material);
  if (environment) list = list.filter(pl => pl.environment === environment);

  const withWeapon = list.map(pl => ({
    ...pl,
    weapon: weapons.get(pl.weaponId) || null
  }));

  withWeapon.sort((a, b) => new Date(a.nextMaintenanceDate) - new Date(b.nextMaintenanceDate));

  const total = withWeapon.length;
  const start = (p - 1) * ps;
  const paginated = withWeapon.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.get('/plans/:weaponId', (req, res) => {
  const plan = maintenancePlans.get(req.params.weaponId);
  if (!plan) return res.fail('养护计划不存在', 404);

  const weapon = weapons.get(req.params.weaponId);
  return res.success({ ...plan, weapon });
});

router.post('/plans/:weaponId/recalculate', (req, res) => {
  const plan = maintenancePlans.get(req.params.weaponId);
  if (!plan) return res.fail('养护计划不存在', 404);

  const { material, environment } = req.body;
  const mat = material || plan.material;
  const env = environment || plan.environment;
  const now = new Date();

  plan.material = mat;
  plan.environment = env;
  plan.cycleDays = calculateMaintenanceDays(mat, env);
  plan.nextMaintenanceDate = addDays(now, plan.cycleDays).toISOString();

  const weapon = weapons.get(req.params.weaponId);
  return res.success({ plan, weapon }, '养护周期已重新计算');
});

router.post('/plans/:weaponId/maintain', (req, res) => {
  const plan = maintenancePlans.get(req.params.weaponId);
  if (!plan) return res.fail('养护计划不存在', 404);

  const { remark, operator, executionMethod, result } = req.body;
  if (!operator) return res.fail('请指定执行人');
  if (!executionMethod) return res.fail('请填写执行方式');
  if (!result) return res.fail('请填写执行结果');

  const now = new Date();

  plan.lastMaintenanceDate = now.toISOString();
  plan.nextMaintenanceDate = addDays(now, plan.cycleDays).toISOString();
  if (!plan.history) plan.history = [];
  plan.history.push({
    time: now.toISOString(),
    operator: operator || '',
    remark: remark || '常规养护'
  });

  const logId = generateId();
  const log = {
    id: logId,
    weaponId: req.params.weaponId,
    planId: plan.id,
    operator,
    executionMethod,
    result,
    remark: remark || '',
    executedAt: now.toISOString()
  };
  maintenanceLogs.set(logId, log);

  const related = Array.from(reminders.values()).filter(
    r => r.weaponId === req.params.weaponId &&
      (r.type === 'maintenance' || r.type === 'maintenance_overdue') &&
      !r.acknowledged
  );
  related.forEach(r => {
    r.acknowledged = true;
    r.acknowledgedAt = now.toISOString();
  });

  const weapon = weapons.get(req.params.weaponId);
  return res.success({ log, plan, weapon }, '养护记录已更新');
});

router.get('/logs', (req, res) => {
  const { weaponId, operator, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(maintenanceLogs.values());
  if (weaponId) list = list.filter(l => l.weaponId === weaponId);
  if (operator) list = list.filter(l => l.operator.includes(operator));

  list.sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt));

  const withWeapon = list.map(l => ({
    ...l,
    weapon: weapons.get(l.weaponId) || null
  }));

  const total = withWeapon.length;
  const start = (p - 1) * ps;
  const paginated = withWeapon.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.get('/logs/weapon/:weaponId', (req, res) => {
  const list = Array.from(maintenanceLogs.values())
    .filter(l => l.weaponId === req.params.weaponId)
    .sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt));
  return res.success(list);
});

router.get('/logs/:logId', (req, res) => {
  const log = maintenanceLogs.get(req.params.logId);
  if (!log) return res.fail('养护日志不存在', 404);
  const weapon = weapons.get(log.weaponId);
  return res.success({ ...log, weapon });
});

router.get('/reminders', (req, res) => {
  generateRemindersForAll();

  const { weaponId, type, acknowledged, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(reminders.values());
  if (weaponId) list = list.filter(r => r.weaponId === weaponId);
  if (type) list = list.filter(r => r.type === type);
  if (acknowledged !== undefined) {
    const ack = acknowledged === 'true' || acknowledged === true;
    list = list.filter(r => r.acknowledged === ack);
  }

  const withWeapon = list.map(r => ({
    ...r,
    weapon: weapons.get(r.weaponId) || null
  }));

  withWeapon.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = withWeapon.length;
  const start = (p - 1) * ps;
  const paginated = withWeapon.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.post('/reminders/:id/acknowledge', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.fail('提醒不存在', 404);

  reminder.acknowledged = true;
  reminder.acknowledgedAt = new Date().toISOString();
  reminder.ackRemark = req.body.remark || '';

  return res.success(reminder, '提醒已确认');
});

router.post('/borrow', (req, res) => {
  const { weaponId, borrower, purpose, expectedReturnDate, contact } = req.body;

  if (!weaponId || !borrower || !expectedReturnDate) {
    return res.fail('请指定兵器ID、借用人和预计归还日期');
  }

  const weapon = weapons.get(weaponId);
  if (!weapon) return res.fail('兵器不存在', 404);

  if (weapon.status !== STATUS.NORMAL) {
    return res.fail(`当前状态 ${weapon.status} 无法外借`);
  }

  const now = new Date();
  weapon.status = STATUS.EXHIBITION;
  weapon.statusHistory.push({ status: STATUS.EXHIBITION, time: now.toISOString(), remark: purpose || '展览外借' });
  weapon.updatedAt = now.toISOString();

  const recordId = generateId();
  const record = {
    id: recordId,
    weaponId,
    borrower,
    contact: contact || '',
    purpose: purpose || '展览',
    borrowDate: now.toISOString(),
    expectedReturnDate,
    actualReturnDate: null,
    status: 'borrowed',
    createdAt: now.toISOString()
  };
  borrowRecords.set(recordId, record);

  return res.success({ record, weapon }, '外借登记成功', 201);
});

router.post('/borrow/:recordId/return', (req, res) => {
  const record = borrowRecords.get(req.params.recordId);
  if (!record) return res.fail('外借记录不存在', 404);
  if (record.status === 'returned') return res.fail('已归还，无需重复操作');

  const { remark } = req.body;
  const now = new Date();

  record.status = 'returned';
  record.actualReturnDate = now.toISOString();
  record.returnRemark = remark || '';

  const weapon = weapons.get(record.weaponId);
  if (weapon) {
    weapon.status = STATUS.NORMAL;
    weapon.statusHistory.push({ status: STATUS.NORMAL, time: now.toISOString(), remark: remark || '外借归还' });
    weapon.updatedAt = now.toISOString();
  }

  const related = Array.from(reminders.values()).filter(
    r => r.borrowRecordId === req.params.recordId && !r.acknowledged
  );
  related.forEach(r => {
    r.acknowledged = true;
    r.acknowledgedAt = now.toISOString();
  });

  return res.success({ record, weapon }, '归还成功');
});

router.get('/borrow', (req, res) => {
  const { weaponId, status, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(borrowRecords.values());
  if (weaponId) list = list.filter(r => r.weaponId === weaponId);
  if (status) list = list.filter(r => r.status === status);

  const withWeapon = list.map(r => ({
    ...r,
    weapon: weapons.get(r.weaponId) || null
  }));

  withWeapon.sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate));

  const total = withWeapon.length;
  const start = (p - 1) * ps;
  const paginated = withWeapon.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

module.exports = {
  router,
  generateRemindersForAll
};
