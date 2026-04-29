const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 只用两个存储：heartbeats（心跳）和 events（事件）
let heartbeats = {}; // deviceId -> [心跳列表]
let events = {};     // deviceId -> [事件列表]

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      heartbeats = data.heartbeats || {};
      events = data.events || {};
      console.log('数据已加载');
    }
  } catch (e) {
    console.log('加载数据失败，使用空数据');
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ heartbeats, events }, null, 2));
  } catch (e) {
    console.error('保存数据失败:', e);
  }
}

loadData();

// ============ 接口 ============

// 心跳上报
app.post('/api/device/heartbeat', (req, res) => {
  const data = req.body;
  const deviceId = data.deviceId;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  data.serverReceiveTime = new Date().toISOString();

  if (!heartbeats[deviceId]) heartbeats[deviceId] = [];
  heartbeats[deviceId].push(data);

  // 只保留最近200条
  if (heartbeats[deviceId].length > 200) {
    heartbeats[deviceId] = heartbeats[deviceId].slice(-200);
  }

  saveData();
  console.log(`心跳: ${data.elderName || deviceId} | 电量${data.batteryPercent}%`);
  res.json({ success: true });
});

// 事件上报
app.post('/api/device/event', (req, res) => {
  const data = req.body;
  const deviceId = data.deviceId;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  data.serverReceiveTime = new Date().toISOString();

  if (!events[deviceId]) events[deviceId] = [];
  events[deviceId].push(data);

  if (events[deviceId].length > 200) {
    events[deviceId] = events[deviceId].slice(-200);
  }

  saveData();
  console.log(`事件: ${deviceId} | ${data.eventType}`);
  res.json({ success: true });
});

// 查询设备最新状态（取心跳最后一条）
app.get('/api/device/:deviceId/latest', (req, res) => {
  const list = heartbeats[req.params.deviceId] || [];
  if (list.length === 0) return res.status(404).json({ error: '设备未找到' });
  res.json(list[list.length - 1]);
});

// 查询设备心跳历史
app.get('/api/device/:deviceId/heartbeats', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const list = (heartbeats[req.params.deviceId] || []).slice(-limit).reverse();
  res.json(list);
});

// 查询设备事件列表
app.get('/api/device/:deviceId/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const list = (events[req.params.deviceId] || []).slice(-limit).reverse();
  res.json(list);
});

// 查询所有设备列表（取每个设备最后一条心跳）
app.get('/api/devices', (req, res) => {
  const deviceList = Object.entries(heartbeats).map(([id, list]) => {
    const latest = list[list.length - 1];
    return {
      deviceId: id,
      elderName: latest.elderName || '未知',
      lastOnline: latest.clientReportTime,
      batteryPercent: latest.batteryPercent,
      networkStatus: latest.networkStatus,
      ringerMode: latest.ringerMode,
      isOnline: isDeviceOnline(latest)
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
  heartbeats = {};
  events = {};
  saveData();
  console.log('数据已清空');
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', deviceCount: Object.keys(heartbeats).length, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  老人关怀 App 后端服务');
  console.log('========================================');
  console.log(`地址: http://localhost:${PORT}`);
  console.log('接口: heartbeat / event / latest / heartbeats / events / devices');
  console.log('========================================');
});
