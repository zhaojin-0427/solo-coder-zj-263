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
  setWeaponStatus,
  generateRemindersForAll,
  acknowledgeRemindersBy
} = require('../store');
const { queryList, contains, parseBool } = require('../helpers/query');

const router = express.Router();

router.get('/plans', (req, res) => {
  const { weaponId, material, environment } = req.query;
  const result = queryList({
    mapData: maintenancePlans,
    filters: { weaponId, material, environment },
    dateField: 'nextMaintenanceDate',
    sortDirection: 'asc',
    withWeapon: true,
    query: req.query
  });
  return res.success(result);
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

  acknowledgeRemindersBy(
    r => r.weaponId === req.params.weaponId &&
      (r.type === 'maintenance' || r.type === 'maintenance_overdue') &&
      !r.acknowledged
  );

  const weapon = weapons.get(req.params.weaponId);
  return res.success({ log, plan, weapon }, '养护记录已更新');
});

router.get('/logs', (req, res) => {
  const { weaponId, operator } = req.query;
  const filters = { weaponId };
  if (operator) {
    filters.operator = contains('operator', operator);
  }
  const result = queryList({
    mapData: maintenanceLogs,
    filters,
    dateField: 'executedAt',
    withWeapon: true,
    query: req.query
  });
  return res.success(result);
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

  const { weaponId, type, acknowledged } = req.query;
  const filters = { weaponId, type };
  if (acknowledged !== undefined) {
    const ack = parseBool(acknowledged);
    filters.acknowledged = ack;
  }
  const result = queryList({
    mapData: reminders,
    filters,
    dateField: 'createdAt',
    withWeapon: true,
    query: req.query
  });
  return res.success(result);
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

  const now = setWeaponStatus(weapon, STATUS.EXHIBITION, purpose || '展览外借');

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
    setWeaponStatus(weapon, STATUS.NORMAL, remark || '外借归还');
  }

  acknowledgeRemindersBy(
    r => r.borrowRecordId === req.params.recordId && !r.acknowledged
  );

  return res.success({ record, weapon }, '归还成功');
});

router.get('/borrow', (req, res) => {
  const { weaponId, status } = req.query;
  const result = queryList({
    mapData: borrowRecords,
    filters: { weaponId, status },
    dateField: 'borrowDate',
    withWeapon: true,
    query: req.query
  });
  return res.success(result);
});

module.exports = {
  router,
  generateRemindersForAll
};
