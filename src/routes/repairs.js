const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  STATUS,
  APPROVAL_STATUS,
  weapons,
  repairs,
  repairApprovals,
  generateId,
  canTransition
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

router.post('/apply', (req, res) => {
  const { weaponId, applicantName, applicantContact, damageDetail, expectedCost } = req.body;

  if (!weaponId || !applicantName) {
    return res.fail('请指定兵器ID和申请人姓名');
  }

  const weapon = weapons.get(weaponId);
  if (!weapon) return res.fail('兵器不存在', 404);

  if (!canTransition(weapon.status, STATUS.PENDING_APPROVAL)) {
    return res.fail(`当前状态 ${weapon.status} 无法提交修复申请`);
  }

  const now = new Date();
  weapon.status = STATUS.PENDING_APPROVAL;
  weapon.statusHistory.push({ status: STATUS.PENDING_APPROVAL, time: now.toISOString(), remark: '提交修复申请' });
  weapon.updatedAt = now.toISOString();

  const approvalId = generateId();
  const approval = {
    id: approvalId,
    weaponId,
    applicant: {
      name: applicantName,
      contact: applicantContact || ''
    },
    damageDetail: damageDetail || '',
    expectedCost: expectedCost || null,
    status: APPROVAL_STATUS.PENDING_PLAN,
    plan: null,
    restorer: null,
    adminRemark: '',
    appliedAt: now.toISOString(),
    planSubmittedAt: null,
    decidedAt: null
  };
  repairApprovals.set(approvalId, approval);

  return res.success({ approval, weapon }, '修复申请已提交', 201);
});

router.post('/approvals/:approvalId/plan', (req, res) => {
  const approval = repairApprovals.get(req.params.approvalId);
  if (!approval) return res.fail('审批记录不存在', 404);
  if (approval.status !== APPROVAL_STATUS.PENDING_PLAN) {
    return res.fail(`当前状态 ${approval.status} 无法录入修复方案`);
  }

  const { restorerName, restorerContact, planDescription, estimatedDays, estimatedCost } = req.body;
  if (!restorerName || !planDescription) {
    return res.fail('请填写修复师姓名和修复方案描述');
  }

  const now = new Date();
  approval.status = APPROVAL_STATUS.PENDING_APPROVAL;
  approval.restorer = {
    name: restorerName,
    contact: restorerContact || ''
  };
  approval.plan = {
    description: planDescription,
    estimatedDays: estimatedDays || null,
    estimatedCost: estimatedCost || null,
    submittedAt: now.toISOString()
  };
  approval.planSubmittedAt = now.toISOString();

  return res.success(approval, '修复方案已录入');
});

router.post('/approvals/:approvalId/approve', (req, res) => {
  const approval = repairApprovals.get(req.params.approvalId);
  if (!approval) return res.fail('审批记录不存在', 404);
  if (approval.status !== APPROVAL_STATUS.PENDING_APPROVAL) {
    return res.fail(`当前状态 ${approval.status} 无法审批`);
  }

  const { adminName, remark } = req.body;
  if (!adminName) return res.fail('请指定审批管理员姓名');

  const now = new Date();
  approval.status = APPROVAL_STATUS.APPROVED;
  approval.adminRemark = remark || '';
  approval.adminName = adminName;
  approval.decidedAt = now.toISOString();

  const weapon = weapons.get(approval.weaponId);
  if (weapon && canTransition(weapon.status, STATUS.PENDING_REPAIR)) {
    weapon.status = STATUS.PENDING_REPAIR;
    weapon.statusHistory.push({ status: STATUS.PENDING_REPAIR, time: now.toISOString(), remark: `审批通过: ${remark || '管理员审批通过'}` });
    weapon.updatedAt = now.toISOString();
  }

  return res.success({ approval, weapon }, '审批通过');
});

router.post('/approvals/:approvalId/reject', (req, res) => {
  const approval = repairApprovals.get(req.params.approvalId);
  if (!approval) return res.fail('审批记录不存在', 404);
  if (approval.status !== APPROVAL_STATUS.PENDING_APPROVAL) {
    return res.fail(`当前状态 ${approval.status} 无法审批`);
  }

  const { adminName, remark } = req.body;
  if (!adminName) return res.fail('请指定审批管理员姓名');
  if (!remark) return res.fail('驳回时请填写驳回原因');

  const now = new Date();
  approval.status = APPROVAL_STATUS.REJECTED;
  approval.adminRemark = remark;
  approval.adminName = adminName;
  approval.decidedAt = now.toISOString();

  const weapon = weapons.get(approval.weaponId);
  if (weapon && canTransition(weapon.status, STATUS.NORMAL)) {
    weapon.status = STATUS.NORMAL;
    weapon.statusHistory.push({ status: STATUS.NORMAL, time: now.toISOString(), remark: `审批驳回: ${remark}` });
    weapon.updatedAt = now.toISOString();
  }

  return res.success({ approval, weapon }, '审批已驳回');
});

router.get('/approvals', (req, res) => {
  const { weaponId, status, page = 1, pageSize = 20 } = req.query;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  let list = Array.from(repairApprovals.values());
  if (weaponId) list = list.filter(a => a.weaponId === weaponId);
  if (status) list = list.filter(a => a.status === status);

  list.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

  const withWeapon = list.map(a => ({
    ...a,
    weapon: weapons.get(a.weaponId) || null
  }));

  const total = withWeapon.length;
  const start = (p - 1) * ps;
  const paginated = withWeapon.slice(start, start + ps);

  return res.success({ list: paginated, total, page: p, pageSize: ps });
});

router.get('/approvals/:approvalId', (req, res) => {
  const approval = repairApprovals.get(req.params.approvalId);
  if (!approval) return res.fail('审批记录不存在', 404);
  const weapon = weapons.get(approval.weaponId);
  return res.success({ ...approval, weapon });
});

router.get('/approvals/weapon/:weaponId', (req, res) => {
  const list = Array.from(repairApprovals.values())
    .filter(a => a.weaponId === req.params.weaponId)
    .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  return res.success(list);
});

router.post('/accept', (req, res) => {
  const { weaponId, restorerName, restorerContact, remark } = req.body;

  if (!weaponId || !restorerName) {
    return res.fail('请指定兵器ID和修复师姓名');
  }

  const weapon = weapons.get(weaponId);
  if (!weapon) return res.fail('兵器不存在', 404);

  const rejectedApproval = Array.from(repairApprovals.values()).find(
    a => a.weaponId === weaponId && a.status === APPROVAL_STATUS.REJECTED
  );
  const approvedApproval = Array.from(repairApprovals.values()).find(
    a => a.weaponId === weaponId && a.status === APPROVAL_STATUS.APPROVED
  );

  if (rejectedApproval && !approvedApproval) {
    return res.fail('该兵器修复申请已被驳回，不能接单修复，请重新提交申请');
  }

  if (!approvedApproval) {
    return res.fail('该兵器尚未通过审批，无法接单修复');
  }

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
    approvalId: approvedApproval.id,
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
