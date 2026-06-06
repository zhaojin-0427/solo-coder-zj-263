const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  STATUS,
  weapons,
  repairs,
  generateId,
  canTransition
} = require('../store');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${generateId()}${ext}`);
  }
});
const upload = multer({ storage });

router.post('/accept', (req, res) => {
  const { weaponId, restorerName, restorerContact, remark } = req.body;

  if (!weaponId || !restorerName) {
    return res.fail('请指定兵器ID和修复师姓名');
  }

  const weapon = weapons.get(weaponId);
  if (!weapon) return res.fail('兵器不存在', 404);

  if (!canTransition(weapon.status, STATUS.REPAIRING)) {
    return res.fail(`当前状态 ${weapon.status} 无法开始修复`);
  }

  const now = new Date();
  weapon.status = STATUS.REPAIRING;
  weapon.statusHistory.push({ status: STATUS.REPAIRING, time: now.toISOString(), remark: remark || '修复师接单' });
  weapon.updatedAt = now.toISOString();

  const repairId = generateId();
  const repair = {
    id: repairId,
    weaponId,
    restorer: {
      name: restorerName,
      contact: restorerContact || ''
    },
    status: 'in_progress',
    acceptedAt: now.toISOString(),
    process: [],
    materialsUsed: [],
    beforePhotos: [],
    afterPhotos: [],
    remark: remark || ''
  };
  repairs.set(repairId, repair);

  return res.success({ repair, weapon }, '接单成功', 201);
});

router.post('/:repairId/process', (req, res) => {
  const repair = repairs.get(req.params.repairId);
  if (!repair) return res.fail('修复记录不存在', 404);
  if (repair.status !== 'in_progress') return res.fail('修复已结束，无法再添加工艺记录');

  const { technique, description } = req.body;
  if (!technique) return res.fail('请填写修复工艺名称');

  repair.process.push({
    technique,
    description: description || '',
    time: new Date().toISOString()
  });

  return res.success(repair, '修复工艺已记录');
});

router.post('/:repairId/materials', (req, res) => {
  const repair = repairs.get(req.params.repairId);
  if (!repair) return res.fail('修复记录不存在', 404);
  if (repair.status !== 'in_progress') return res.fail('修复已结束，无法再添加材料');

  const { name, quantity, unit, remark } = req.body;
  if (!name || !quantity) return res.fail('请填写材料名称和数量');

  repair.materialsUsed.push({
    name,
    quantity,
    unit: unit || '',
    remark: remark || '',
    time: new Date().toISOString()
  });

  return res.success(repair, '使用材料已记录');
});

router.post('/:repairId/photos', upload.array('photos', 20), (req, res) => {
  const repair = repairs.get(req.params.repairId);
  if (!repair) return res.fail('修复记录不存在', 404);

  const { type } = req.body;
  if (!type || (type !== 'before' && type !== 'after')) {
    return res.fail('请指定照片类型: before 或 after');
  }

  const photos = (req.files || []).map(f => `/uploads/${f.filename}`);

  if (type === 'before') {
    repair.beforePhotos = [...repair.beforePhotos, ...photos];
  } else {
    repair.afterPhotos = [...repair.afterPhotos, ...photos];
  }

  return res.success(repair, '照片已上传');
});

router.post('/:repairId/complete', (req, res) => {
  const repair = repairs.get(req.params.repairId);
  if (!repair) return res.fail('修复记录不存在', 404);
  if (repair.status !== 'in_progress') return res.fail('修复已完成或已取消');

  const { summary, cost } = req.body;
  const now = new Date();

  repair.status = 'completed';
  repair.completedAt = now.toISOString();
  repair.summary = summary || '';
  repair.cost = cost || null;

  const weapon = weapons.get(repair.weaponId);
  if (weapon && canTransition(weapon.status, STATUS.REPAIRED)) {
    weapon.status = STATUS.REPAIRED;
    weapon.statusHistory.push({ status: STATUS.REPAIRED, time: now.toISOString(), remark: summary || '修复完成' });
    weapon.updatedAt = now.toISOString();
  }

  return res.success({ repair, weapon }, '修复完成');
});

router.get('/', (req, res) => {
  const { weaponId, status, restorerName, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(repairs.values());
  if (weaponId) list = list.filter(r => r.weaponId === weaponId);
  if (status) list = list.filter(r => r.status === status);
  if (restorerName) list = list.filter(r => r.restorer.name.includes(restorerName));

  list.sort((a, b) => new Date(b.acceptedAt) - new Date(a.acceptedAt));

  const total = list.length;
  const start = (p - 1) * ps;
  const paginated = list.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.get('/:repairId', (req, res) => {
  const repair = repairs.get(req.params.repairId);
  if (!repair) return res.fail('修复记录不存在', 404);
  return res.success(repair);
});

module.exports = router;
