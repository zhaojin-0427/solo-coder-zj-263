const express = require('express');
const path = require('path');
const fs = require('fs');

const { unifiedResponse, notFoundHandler, errorHandler } = require('./src/middleware');
const weaponsRouter = require('./src/routes/weapons');
const repairsRouter = require('./src/routes/repairs');
const { router: maintenanceRouter, generateRemindersForAll } = require('./src/routes/maintenance');
const statsRouter = require('./src/routes/stats');

const app = express();
const PORT = 9601;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(uploadDir));

app.use(unifiedResponse);

app.get('/', (req, res) => {
  res.success({
    service: '传统兵器修复档案与养护提醒 API 服务',
    version: '1.0.0',
    port: PORT,
    endpoints: {
      weapons: '/api/weapons',
      repairs: '/api/repairs',
      maintenance: '/api/maintenance',
      stats: '/api/stats'
    }
  });
});

app.get('/health', (req, res) => {
  res.success({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/weapons', weaponsRouter);
app.use('/api/repairs', repairsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/stats', statsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

setInterval(() => {
  try {
    generateRemindersForAll();
  } catch (err) {
    console.error('生成提醒时出错:', err.message);
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`传统兵器修复档案与养护提醒 API 服务已启动`);
  console.log(`端口: ${PORT}`);
  console.log(`基础地址: http://localhost:${PORT}`);
});

module.exports = app;
