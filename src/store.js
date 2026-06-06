const { v4: uuidv4 } = require('uuid');

const STATUS = {
  NORMAL: 'normal_storage',
  PENDING_APPROVAL: 'pending_approval',
  PENDING_REPAIR: 'pending_repair',
  REPAIRING: 'repairing',
  REPAIRED: 'repaired',
  EXHIBITION: 'exhibition_borrowed'
};

const STATUS_TRANSITIONS = {
  [STATUS.NORMAL]: [STATUS.PENDING_APPROVAL, STATUS.EXHIBITION],
  [STATUS.PENDING_APPROVAL]: [STATUS.PENDING_REPAIR, STATUS.NORMAL],
  [STATUS.PENDING_REPAIR]: [STATUS.REPAIRING, STATUS.NORMAL],
  [STATUS.REPAIRING]: [STATUS.REPAIRED],
  [STATUS.REPAIRED]: [STATUS.NORMAL, STATUS.PENDING_REPAIR],
  [STATUS.EXHIBITION]: [STATUS.NORMAL]
};

const APPROVAL_STATUS = {
  PENDING_PLAN: 'pending_plan',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const MATERIAL_MAINTENANCE_DAYS = {
  bronze: 180,
  iron: 90,
  steel: 120,
  wood: 60,
  bamboo: 45,
  jade: 365,
  leather: 75,
  silk: 100,
  other: 150
};

const ENVIRONMENT_FACTOR = {
  dry: 1.2,
  normal: 1.0,
  humid: 0.7,
  high_temp: 0.6,
  museum: 1.5
};

const weapons = new Map();
const repairs = new Map();
const repairApprovals = new Map();
const maintenancePlans = new Map();
const maintenanceLogs = new Map();
const reminders = new Map();
const borrowRecords = new Map();

const generateId = () => uuidv4();

function calculateMaintenanceDays(material, environment) {
  const baseDays = MATERIAL_MAINTENANCE_DAYS[material] || MATERIAL_MAINTENANCE_DAYS.other;
  const factor = ENVIRONMENT_FACTOR[environment] || ENVIRONMENT_FACTOR.normal;
  return Math.round(baseDays * factor);
}

function canTransition(currentStatus, nextStatus) {
  const allowed = STATUS_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((date2 - date1) / oneDay);
}

function updateWeaponStatus(weapon, nextStatus, remark = '') {
  if (!canTransition(weapon.status, nextStatus)) return false;
  const now = new Date();
  weapon.status = nextStatus;
  weapon.statusHistory.push({ status: nextStatus, time: now.toISOString(), remark });
  weapon.updatedAt = now.toISOString();
  return true;
}

function setWeaponStatus(weapon, nextStatus, remark = '') {
  const now = new Date();
  weapon.status = nextStatus;
  weapon.statusHistory.push({ status: nextStatus, time: now.toISOString(), remark });
  weapon.updatedAt = now.toISOString();
  return now;
}

function findApprovalByWeapon(weaponId, status) {
  return Array.from(repairApprovals.values()).find(
    a => a.weaponId === weaponId && a.status === status
  );
}

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

function acknowledgeRemindersBy(predicate) {
  const now = new Date().toISOString();
  const related = Array.from(reminders.values()).filter(predicate);
  related.forEach(r => {
    r.acknowledged = true;
    r.acknowledgedAt = now;
  });
  return related;
}

module.exports = {
  STATUS,
  STATUS_TRANSITIONS,
  APPROVAL_STATUS,
  MATERIAL_MAINTENANCE_DAYS,
  ENVIRONMENT_FACTOR,
  weapons,
  repairs,
  repairApprovals,
  maintenancePlans,
  maintenanceLogs,
  reminders,
  borrowRecords,
  generateId,
  calculateMaintenanceDays,
  canTransition,
  addDays,
  daysBetween,
  updateWeaponStatus,
  setWeaponStatus,
  findApprovalByWeapon,
  generateRemindersForAll,
  acknowledgeRemindersBy
};
