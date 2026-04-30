const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

const DB_PATH = path.join(__dirname, 'guardian.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 初始化 SQLite
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_device ON heartbeats(device_id);
  CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(created_at);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_device ON events(device_id);
`);

console.log('SQLite 数据库已连接:', DB_PATH);

// ============ 接口 ============

// 心跳上报
app.post('/api/device/heartbeat', (req, res) => {
  const data = req.body;
  const deviceId = data.deviceId;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  data.serverReceiveTime = new Date().toISOString();

  db.prepare('INSERT INTO heartbeats (device_id, payload) VALUES (?, ?)')
    .run(deviceId, JSON.stringify(data));

  console.log(`心跳: ${data.elderName || deviceId} | 电量${data.batteryPercent}%`);
  res.json({ success: true });
});

// 事件上报
app.post('/api/device/event', (req, res) => {
  const data = req.body;
  const deviceId = data.deviceId;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  data.serverReceiveTime = new Date().toISOString();

  db.prepare('INSERT INTO events (device_id, payload) VALUES (?, ?)')
    .run(deviceId, JSON.stringify(data));

  console.log(`事件: ${deviceId} | ${data.eventType}`);
  res.json({ success: true });
});

// 查询设备最新状态
app.get('/api/device/:deviceId/latest', (req, res) => {
  const row = db.prepare(
    'SELECT payload FROM heartbeats WHERE device_id = ? ORDER BY id DESC LIMIT 1'
  ).get(req.params.deviceId);

  if (!row) return res.status(404).json({ error: '设备未找到' });
  res.json(JSON.parse(row.payload));
});

// 查询设备心跳历史
app.get('/api/device/:deviceId/heartbeats', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const rows = db.prepare(
    'SELECT payload FROM heartbeats WHERE device_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.params.deviceId, limit);

  res.json(rows.map(r => JSON.parse(r.payload)));
});

// 查询设备事件列表
app.get('/api/device/:deviceId/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const rows = db.prepare(
    'SELECT payload FROM events WHERE device_id = ? ORDER BY id DESC LIMIT ?'
  ).all(req.params.deviceId, limit);

  res.json(rows.map(r => JSON.parse(r.payload)));
});

// 查询所有设备列表（取每个设备最后一条心跳）
app.get('/api/devices', (req, res) => {
  const devices = db.prepare(`
    SELECT device_id, payload FROM heartbeats
    WHERE id IN (SELECT MAX(id) FROM heartbeats GROUP BY device_id)
    ORDER BY id DESC
  `).all();

  const deviceList = devices.map(d => {
    const data = JSON.parse(d.payload);
    return {
      deviceId: d.device_id,
      elderName: data.elderName || '未知',
      lastOnline: data.clientReportTime,
      batteryPercent: data.batteryPercent,
      networkStatus: data.networkStatus,
      ringerMode: data.ringerMode,
      mobileDataEnabled: data.mobileDataEnabled,
      isOnline: isDeviceOnline(data)
    };
  });

  res.json(deviceList);
});

function isDeviceOnline(data) {
  if (!data.clientReportTime) return false;
  const diffMinutes = (Date.now() - new Date(data.clientReportTime).getTime()) / (1000 * 60);
  return diffMinutes < 45;
}

// 清空所有数据
app.post('/api/clear', (req, res) => {
  db.exec('DELETE FROM heartbeats; DELETE FROM events;');
  console.log('数据已清空');
  res.json({ success: true });
});

// 健康检查
app.get('/api/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(DISTINCT device_id) as c FROM heartbeats').get();
  res.json({ status: 'ok', deviceCount: count.c, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  安心守护 - 后端服务');
  console.log('========================================');
  console.log(`地址: http://localhost:${PORT}`);
  console.log('存储: SQLite (guardian.db)');
  console.log('========================================');
});
