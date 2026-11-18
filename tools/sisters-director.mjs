#!/usr/bin/env node
/**
 * dsh-pet-ai-sisters v4.1 — Optional Companion Choreography Director (`sisters-director.mjs`)
 *
 * Zero-intrusion external plugin using `dsh-pet`'s official HTTP control API (`/dsh-pet-7340/*`):
 * - Injects interactive stunts right into `dsh-pet`'s native Right-Click ->「更多」menu (`POST /menu/item`)
 * - Drives window-roof perching (`POST /position` mode=spring), multi-sister synchronized duets
 *   (`POST /position` + `POST /anim` + `POST /broadcast`), folder exploration, and glass knocking!
 *
 * Usage:
 *   node tools/sisters-director.mjs
 *   node tools/sisters-director.mjs --url http://127.0.0.1:7340 --token <optional_standalone_token>
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROUTE_PREFIX = '/dsh-pet-7340';
const OWNER_ID = 'ai-sisters-director';

const MENU_LABELS = [
  '🪑 跳上当前窗口顶晃脚',
  '💕 召唤姐妹贴贴小剧场',
  '📁 跑去桌面文件夹探头',
  '👊 咚咚敲屏幕玻璃',
  '☁️ 抱云朵小憩一会儿',
];

const BOND_LINES = {
  'claude+claude-fish': ['末妹快来~ 姐姐刚冲好热腾腾的燕麦拿铁☕', '哇！！谢谢姐姐，配我的大白米饭最香啦🐟💕'],
  'qwen+qwq': ['QwQ 妹妹呆毛转这么快，推演出答案啦🪭？', '叮✨ 满分证毕 Q.E.D. ★ 快夸夸我！'],
  'gemini+grok': ['Surprise✨ 要不要比比谁先跳上主人的窗口顶？', '比就比✌ 输的人请吃纳米香蕉⚡！'],
  'chatgpt+kimi': ['Kimi 妹妹读长卷辛苦啦，喝口热红茶歇歇吧💜', '谢谢龙娘姐姐，刚好这一乐章圆满收尾啦🌙♪'],
  'doubao+yuanbao': ['热乎乎的大白包子分元宝酱一个🥟！', '哇谢谢豆包酱！课代表帮你记朵小红花🪙✨'],
};

function parseArgs(argv) {
  const out = { url: process.env.DSH_PET_URL || '', token: process.env.DSH_PET_TOKEN || '' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (argv[i] === '--token' && argv[i + 1]) out.token = argv[++i];
  }
  return out;
}

function discoverConnection() {
  const cli = parseArgs(process.argv);
  if (cli.url) {
    const u = new URL(cli.url);
    const hashMatch = u.hash.match(/token=([A-Za-z0-9_-]+)/);
    return {
      origin: u.origin,
      token: cli.token || (hashMatch ? hashMatch[1] : ''),
    };
  }
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const runtimeFile = join(dshHome, 'dsh-pet', 'standalone-runtime.json');
  if (existsSync(runtimeFile)) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info && info.port) {
        return {
          origin: `http://127.0.0.1:${info.port}`,
          token: String(info.token || ''),
        };
      }
    } catch {
      // fall through to logs.txt discovery
    }
  }
  const logFile = join(dshHome, 'dsh-pet', 'logs.txt');
  if (existsSync(logFile)) {
    try {
      const tail = readFileSync(logFile, 'utf8').slice(-32768);
      const matches = [...tail.matchAll(/http:\/\/127\.0\.0\.1:(\d+)/g)];
      if (matches.length > 0) {
        const lastPort = matches[matches.length - 1][1];
        return { origin: `http://127.0.0.1:${lastPort}`, token: cli.token };
      }
    } catch {
      // fall through to default port
    }
  }
  return { origin: 'http://127.0.0.1:7340', token: cli.token };
}

async function callPetApi(conn, method, subPath, bodyObj = undefined) {
  const headers = { host: new URL(conn.origin).host };
  if (conn.token) headers['x-dsh-pet-token'] = conn.token;
  let body;
  if (bodyObj !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(bodyObj);
  }
  const res = await fetch(`${conn.origin}${ROUTE_PREFIX}${subPath}`, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, raw: text };
  }
}

/** Query active non-maximized foreground window normalized coordinates on Windows (fallback to center-top). */
async function queryTopWindowNormalized() {
  if (process.platform !== 'win32') return { x: 0.55, y: 0.24 };
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRectHelper {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
}
"@
$h = [WinRectHelper]::GetForegroundWindow()
$r = New-Object WinRectHelper+RECT
[void][WinRectHelper]::GetWindowRect($h, [ref]$r)
$sw = [Math]::Max(1, [WinRectHelper]::GetSystemMetrics(0))
$sh = [Math]::Max(1, [WinRectHelper]::GetSystemMetrics(1))
Write-Output "$($r.L),$($r.T),$($r.R),$($r.B),$sw,$sh"
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], { timeout: 2500 });
    const parts = stdout.trim().split(',').map(Number);
    if (parts.length === 6 && parts.every(Number.isFinite)) {
      const [l, t, r, , sw, sh] = parts;
      if (t > 35 && r - l > 220) {
        const nx = Math.min(0.88, Math.max(0.12, (l + (r - l) * (0.35 + Math.random() * 0.35)) / sw));
        const ny = Math.min(0.85, Math.max(0.08, (t - 45) / sh));
        return { x: nx, y: ny };
      }
    }
  } catch {
    // fallback below
  }
  return { x: 0.52, y: 0.28 };
}

async function listActiveSisterIds(conn) {
  const state = await callPetApi(conn, 'GET', '/state');
  const petsObj = state?.sections?.pets?.pets || state?.pets || {};
  const ids = Object.keys(petsObj);
  if (ids.length > 0) return ids;
  return ['gemini', 'claude', 'chatgpt', 'qwen', 'kimi', 'grok'];
}

async function runSisterDuet(conn, petId) {
  const allIds = await listActiveSisterIds(conn);
  const partner = allIds.find((id) => id !== petId) || 'claude';
  if (partner === petId) {
    await callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '点击回应-开心跃动' });
    await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '快来设置里多开启一位好姐妹，我们就能表演双人贴贴小剧场啦💕！',
      image: '元气问候',
      duration: 5000,
      anim: false,
    });
    return;
  }

  const targetX = 0.48;
  const targetY = 0.84;
  await Promise.all([
    callPetApi(conn, 'POST', `/position?pet=${encodeURIComponent(petId)}`, { x: targetX - 0.06, y: targetY, mode: 'spring' }),
    callPetApi(conn, 'POST', `/position?pet=${encodeURIComponent(partner)}`, { x: targetX + 0.06, y: targetY, mode: 'spring' }),
  ]);

  const k1 = `${petId}+${partner}`;
  const k2 = `${partner}+${petId}`;
  const pairLines = BOND_LINES[k1] || (BOND_LINES[k2] ? [BOND_LINES[k2][1], BOND_LINES[k2][0]] : [
    `找到你啦~ 今天一起在主人的桌面上陪写代码吧💕！`,
    `好呀好呀！姐妹贴贴，主人的 Bug 统统退散✨！`,
  ]);

  setTimeout(async () => {
    await Promise.all([
      callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '点击回应-元气挥手', facing: 'right' }),
      callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(partner)}`, { name: '点击回应-开心跃动', facing: 'left' }),
      callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
        text: pairLines[0],
        image: '元气问候',
        duration: 4800,
        anim: false,
      }),
    ]);
  }, 650);

  setTimeout(async () => {
    await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(partner)}`, {
      text: pairLines[1],
      image: '可爱卖萌',
      duration: 5000,
      anim: false,
    });
  }, 2100);
}

async function handleMenuClick(conn, ev) {
  const { label, petId } = ev;
  if (!petId) return;
  console.log(`[sisters-director] 触发动作: [${petId}] -> ${label}`);

  if (label.includes('跳上当前窗口顶晃脚')) {
    const winPt = await queryTopWindowNormalized();
    await callPetApi(conn, 'POST', `/position?pet=${encodeURIComponent(petId)}`, {
      x: winPt.x,
      y: winPt.y,
      mode: 'spring',
    });
    await callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '坐姿悠闲晃脚' });
    await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '嘿咻跳上窗口顶坐稳啦✨ 小短腿晃呀晃~',
      duration: 4500,
      anim: false,
    });
  } else if (label.includes('召唤姐妹贴贴')) {
    await runSisterDuet(conn, petId);
  } else if (label.includes('桌面文件夹探头')) {
    await callPetApi(conn, 'POST', `/position?pet=${encodeURIComponent(petId)}`, {
      x: 0.10,
      y: 0.26 + Math.random() * 0.35,
      mode: 'spring',
    });
    setTimeout(async () => {
      await callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '钻文件夹探头' });
      await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
        text: '钻进桌面文件夹口袋翻宝贝咯📁✨！',
        duration: 4500,
        anim: false,
      });
    }, 550);
  } else if (label.includes('咚咚敲屏幕玻璃')) {
    await callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '敲敲玻璃求关注' });
    await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '咚咚咚！看我一眼嘛，工作再忙也要记得喝水休息哟✨',
      duration: 4800,
      anim: false,
    });
  } else if (label.includes('抱云朵小憩')) {
    await callPetApi(conn, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '抱云朵小憩' });
    await callPetApi(conn, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '抱住软绵绵的小云朵咪一会儿💤~',
      duration: 4800,
      anim: false,
    });
  }
}

async function main() {
  const conn = discoverConnection();
  console.log(`[sisters-director] 正在连接 dsh-pet 控制接口: ${conn.origin}${ROUTE_PREFIX} ...`);

  const reg = await callPetApi(conn, 'POST', '/menu/item', {
    owner: OWNER_ID,
    labels: MENU_LABELS,
    target: 'both',
  });

  if (!reg || reg.ok !== true) {
    console.error('[sisters-director] 未能注册右键菜单:', reg);
    console.error(
      '提示：若使用独立打包版 dsh-pet，请右键桌宠 ->「打开 AI 设置」，复制浏览器地址栏完整 URL 后运行：\n' +
        '  node tools/sisters-director.mjs --url "<粘贴设置页完整地址>"',
    );
    process.exit(1);
  }

  console.log('[sisters-director] ✅ 注册成功！现在右键任意桌宠 ->「更多」即可看到 5 项破壁与双人互动菜单✨ (按 Ctrl+C 退出)');

  const cleanup = async () => {
    try {
      await callPetApi(conn, 'DELETE', `/menu/item?owner=${encodeURIComponent(OWNER_ID)}`);
    } catch {
      // ignore on exit
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  while (true) {
    try {
      const poll = await callPetApi(conn, 'GET', `/menu/events?owner=${encodeURIComponent(OWNER_ID)}&wait=9000`);
      if (poll?.reason === 'unknown-owner') {
        await callPetApi(conn, 'POST', '/menu/item', { owner: OWNER_ID, labels: MENU_LABELS, target: 'both' });
        continue;
      }
      if (Array.isArray(poll?.events)) {
        for (const ev of poll.events) {
          await handleMenuClick(conn, ev);
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main();
