const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  STATUS,
  weapons,
  maintenancePlans,
  generateId,
  calculateMaintenanceDays,
  canTransition,
  addDays
} = require('../store');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${generateId()}${ext}`);
  }
});

const upload = multer({ storage });

router.post('/', upload.array('photos', 10), (req, res) => {
  const { name, era, material, environment, damageDescription, ownerName, ownerContact, description } = req.body;

  if (!name || !era || !material) {
    return res.fail('请填写兵器名称、年代和材质');
  }

  const photos = (req.files || []).map(f => `/uploads/${f.filename}`);

  const weaponId = generateId();
  const now = new Date();
  const maintenanceDays = calculateMaintenanceDays(material, environment);
  const nextMaintenanceDate = addDays(now, maintenanceDays);

  const weapon = {
    id: weaponId,
    name,
    era,
    material,
    environment: environment || 'normal',
    damageDescription: damageDescription || '',
    description: description || '',
    photos,
    owner: {
      name: ownerName || '',
      contact: ownerContact || ''
    },
    status: STATUS.NORMAL,
    statusHistory: [{ status: STATUS.NORMAL, time: now.toISOString(), remark: '初始登记' }],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  weapons.set(weaponId, weapon);

  const planId = generateId();
  const maintenancePlan = {
    id: planId,
    weaponId,
    material,
    environment: environment || 'normal',
    cycleDays: maintenanceDays,
    lastMaintenanceDate: now.toISOString(),
    nextMaintenanceDate: nextMaintenanceDate.toISOString(),
    createdAt: now.toISOString()
  };
  maintenancePlans.set(weaponId, maintenancePlan);

  return res.success({ weapon, maintenancePlan }, '兵器登记成功', 201);
});

router.get('/', (req, res) => {
  const { status, era, material, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(weapons.values());
  if (status) list = list.filter(w => w.status === status);
  if (era) list = list.filter(w => w.era === era);
  if (material) list = list.filter(w => w.material === material);

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = list.length;
  const start = (p - 1) * ps;
  const paginated = list.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.get('/:id', (req, res) => {
  const weapon = weapons.get(req.params.id);
  if (!weapon) return res.fail('兵器不存在', 404);
  return res.success(weapon);
});

router.put('/:id', upload.array('photos', 10), (req, res) => {
  const weapon = weapons.get(req.params.id);
  if (!weapon) return res.fail('兵器不存在', 404);

  const { name, era, material, environment, damageDescription, description, ownerName, ownerContact } = req.body;
  const now = new Date();

  if (name) weapon.name = name;
  if (era) weapon.era = era;
  if (damageDescription !== undefined) weapon.damageDescription = damageDescription;
  if (description !== undefined) weapon.description = description;

  if (ownerName !== undefined) weapon.owner = { ...weapon.owner, name: ownerName };
  if (ownerContact !== undefined) weapon.owner = { ...weapon.owner, contact: ownerContact };

  if (req.files && req.files.length > 0) {
    const newPhotos = req.files.map(f => `/uploads/${f.filename}`);
    weapon.photos = [...weapon.photos, ...newPhotos];
  }

  if (material || environment) {
    const newMaterial = material || weapon.material;
    const newEnv = environment || weapon.environment;
    weapon.material = newMaterial;
    weapon.environment = newEnv;

    const plan = maintenancePlans.get(weapon.id);
    if (plan) {
      const newCycle = calculateMaintenanceDays(newMaterial, newEnv);
      plan.material = newMaterial;
      plan.environment = newEnv;
      plan.cycleDays = newCycle;
      plan.nextMaintenanceDate = addDays(new Date(plan.lastMaintenanceDate), newCycle).toISOString();
    }
  }

  weapon.updatedAt = now.toISOString();
  return res.success(weapon, '兵器信息更新成功');
});

router.post('/:id/status', (req, res) => {
  const weapon = weapons.get(req.params.id);
  if (!weapon) return res.fail('兵器不存在', 404);

  const { status, remark } = req.body;
  if (!status) return res.fail('请指定目标状态');

  if (!canTransition(weapon.status, status)) {
    return res.fail(`不允许从 ${weapon.status} 转换到 ${status}`);
  }

  const now = new Date();
  weapon.status = status;
  weapon.statusHistory.push({ status, time: now.toISOString(), remark: remark || '' });
  weapon.updatedAt = now.toISOString();

  return res.success(weapon, '状态更新成功');
});

router.delete('/:id', (req, res) => {
  const weapon = weapons.get(req.params.id);
  if (!weapon) return res.fail('兵器不存在', 404);
  weapons.delete(req.params.id);
  maintenancePlans.delete(req.params.id);
  return res.success(null, '删除成功');
});

module.exports = router;
