const { v4: uuidv4 } = require('uuid');

const STATUS = {
  NORMAL: 'normal_storage',
  PENDING_REPAIR: 'pending_repair',
  REPAIRING: 'repairing',
  REPAIRED: 'repaired',
  EXHIBITION: 'exhibition_borrowed'
};

const STATUS_TRANSITIONS = {
  [STATUS.NORMAL]: [STATUS.PENDING_REPAIR, STATUS.EXHIBITION],
  [STATUS.PENDING_REPAIR]: [STATUS.REPAIRING, STATUS.NORMAL],
  [STATUS.REPAIRING]: [STATUS.REPAIRED],
  [STATUS.REPAIRED]: [STATUS.NORMAL, STATUS.PENDING_REPAIR],
  [STATUS.EXHIBITION]: [STATUS.NORMAL]
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
const maintenancePlans = new Map();
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

module.exports = {
  STATUS,
  STATUS_TRANSITIONS,
  MATERIAL_MAINTENANCE_DAYS,
  ENVIRONMENT_FACTOR,
  weapons,
  repairs,
  maintenancePlans,
  reminders,
  borrowRecords,
  generateId,
  calculateMaintenanceDays,
  canTransition,
  addDays,
  daysBetween
};
