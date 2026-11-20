/**
 * `dsh-pet-ai-sisters` — Official DeepSeek Harness (`dsh`) Bundle Plugin Entry.
 *
 * When installed via DSH Plugin Manager (`dsh plugin add dsh-pet-ai-sisters`, `dshmarket`, or GitHub URL):
 * 1. Automatically installs/updates all 16 AI Sisters (272 24fps WebMs, 64 stickers, 16 avatars, 16 configs)
 *    into `$DSH_HOME/dsh-pet/pet/` while preserving any user-customized display/size preferences.
 * 2. Automatically triggers `/dsh-pet-7340/reload` so the sisters appear immediately without restarting DSH.
 * 3. Automatically mounts the 5 interactive right-click「更多」menu actions (window perching, sister duets,
 *    folder exploration, glass knocking, cloud nap) and cleans them up cleanly when disabled/uninstalled.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  discoverDshPetEndpoint,
  notifyDshPetHotReload,
  syncSistersToDshPet,
} from './src/installer.mjs';

const execFileAsync = promisify(execFile);

export const name = 'dsh-pet-ai-sisters';

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

async function callPetApi(ep, method, subPath, bodyObj = undefined, signal = undefined) {
  const headers = { host: new URL(ep.origin).host };
  if (ep.token) headers['x-dsh-pet-token'] = ep.token;
  let body;
  if (bodyObj !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(bodyObj);
  }
  const res = await fetch(`${ep.origin}${ROUTE_PREFIX}${subPath}`, {
    method,
    headers,
    body,
    signal,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: res.status };
  }
}

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
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      timeout: 2500,
    });
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

async function dispatchMenuEvent(ep, ev) {
  const { label, petId } = ev || {};
  if (!petId || !label) return;

  if (label.includes('跳上当前窗口顶晃脚')) {
    const winPt = await queryTopWindowNormalized();
    await callPetApi(ep, 'POST', `/position?pet=${encodeURIComponent(petId)}`, {
      x: winPt.x,
      y: winPt.y,
      mode: 'spring',
    });
    await callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '坐姿悠闲晃脚' });
    await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '嘿咻跳上窗口顶坐稳啦✨ 小短腿晃呀晃~',
      duration: 4500,
      anim: false,
    });
  } else if (label.includes('召唤姐妹贴贴')) {
    const state = await callPetApi(ep, 'GET', '/state');
    const ids = Object.keys(state?.sections?.pets?.pets || state?.pets || {});
    const partner = ids.find((id) => id !== petId);
    if (!partner) {
      await callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '点击回应-开心跃动' });
      await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
        text: '在设置里多开启一位好姐妹，我们就能表演双人贴贴小剧场啦💕！',
        image: '元气问候',
        duration: 5000,
        anim: false,
      });
      return;
    }
    await Promise.all([
      callPetApi(ep, 'POST', `/position?pet=${encodeURIComponent(petId)}`, { x: 0.42, y: 0.84, mode: 'spring' }),
      callPetApi(ep, 'POST', `/position?pet=${encodeURIComponent(partner)}`, { x: 0.54, y: 0.84, mode: 'spring' }),
    ]);
    const k1 = `${petId}+${partner}`;
    const k2 = `${partner}+${petId}`;
    const lines =
      BOND_LINES[k1] ||
      (BOND_LINES[k2]
        ? [BOND_LINES[k2][1], BOND_LINES[k2][0]]
        : ['找到你啦~ 今天一起在主人的桌面上陪写代码吧💕！', '好呀好呀！姐妹贴贴，Bug 统统退散✨！']);

    setTimeout(async () => {
      try {
        await Promise.all([
          callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, {
            name: '点击回应-元气挥手',
            facing: 'right',
          }),
          callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(partner)}`, {
            name: '点击回应-开心跃动',
            facing: 'left',
          }),
          callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
            text: lines[0],
            image: '元气问候',
            duration: 4800,
            anim: false,
          }),
        ]);
      } catch {
        // ignore transient errors
      }
    }, 650);

    setTimeout(async () => {
      try {
        await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(partner)}`, {
          text: lines[1],
          image: '可爱卖萌',
          duration: 5000,
          anim: false,
        });
      } catch {
        // ignore
      }
    }, 2100);
  } else if (label.includes('桌面文件夹探头')) {
    await callPetApi(ep, 'POST', `/position?pet=${encodeURIComponent(petId)}`, {
      x: 0.10,
      y: 0.26 + Math.random() * 0.35,
      mode: 'spring',
    });
    setTimeout(async () => {
      try {
        await callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '钻文件夹探头' });
        await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
          text: '钻进桌面文件夹口袋翻宝贝咯📁✨！',
          duration: 4500,
          anim: false,
        });
      } catch {
        // ignore
      }
    }, 550);
  } else if (label.includes('咚咚敲屏幕玻璃')) {
    await callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '敲敲玻璃求关注' });
    await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '咚咚咚！看我一眼嘛，工作再忙也要记得喝水休息哟✨',
      duration: 4800,
      anim: false,
    });
  } else if (label.includes('抱云朵小憩')) {
    await callPetApi(ep, 'POST', `/anim?pet=${encodeURIComponent(petId)}`, { name: '抱云朵小憩' });
    await callPetApi(ep, 'POST', `/broadcast?pet=${encodeURIComponent(petId)}`, {
      text: '抱住软绵绵的小云朵咪一会儿💤~',
      duration: 4800,
      anim: false,
    });
  }
}

export function apply(ctx, rawConfig = {}) {
  const cfg = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const petsSelection = typeof cfg.pets === 'string' && cfg.pets.trim() ? cfg.pets.trim() : 'all';
  const enableDirector = cfg.enableDirector !== false;
  const logger = ctx?.logger ?? console;

  let syncResult = null;
  try {
    syncResult = syncSistersToDshPet({
      pets: petsSelection,
      dshHome: typeof cfg.dshHome === 'string' ? cfg.dshHome : '',
      logger,
    });
  } catch (err) {
    logger?.warn?.(
      `[dsh-pet-ai-sisters] Failed to sync pet assets: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const registerEffect =
    typeof ctx?.effect === 'function'
      ? (fn) => ctx.effect(fn, 'dsh-pet-ai-sisters: lifecycle')
      : (fn) => fn();

  registerEffect(() => {
    const abortCtrl = new AbortController();
    let disposed = false;

    const runBackground = async () => {
      // Wait briefly for `dsh-pet` in the bundle stack to finish mounting its HTTP route
      await new Promise((r) => setTimeout(r, 1200));
      if (disposed) return;

      if (!syncResult.skipped) {
        await notifyDshPetHotReload(syncResult.dshPetRoot);
      }

      if (!enableDirector) return;

      let registered = false;
      while (!disposed) {
        const ep = discoverDshPetEndpoint(syncResult.dshPetRoot);
        if (!ep) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        try {
          if (!registered) {
            const reg = await callPetApi(
              ep,
              'POST',
              '/menu/item',
              { owner: OWNER_ID, labels: MENU_LABELS, target: 'both' },
              abortCtrl.signal,
            );
            if (reg?.ok === true) {
              registered = true;
            } else {
              await new Promise((r) => setTimeout(r, 4000));
              continue;
            }
          }

          const poll = await callPetApi(
            ep,
            'GET',
            `/menu/events?owner=${encodeURIComponent(OWNER_ID)}&wait=8500`,
            undefined,
            abortCtrl.signal,
          );
          if (poll?.reason === 'unknown-owner') {
            registered = false;
            continue;
          }
          if (Array.isArray(poll?.events)) {
            for (const ev of poll.events) {
              await dispatchMenuEvent(ep, ev);
            }
          }
        } catch {
          if (disposed) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };

    void runBackground();

    return () => {
      disposed = true;
      abortCtrl.abort();
      const ep = discoverDshPetEndpoint(syncResult.dshPetRoot);
      if (ep) {
        void callPetApi(ep, 'DELETE', `/menu/item?owner=${encodeURIComponent(OWNER_ID)}`).catch(
          () => undefined,
        );
      }
    };
  });
}

export default { name, apply };
