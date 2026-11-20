/**
 * Shared Pet Pack Installer, Async CDN Streamer & Smart Config Merger for `dsh-pet-ai-sisters`.
 *
 * - Lightweight npm bundle (`~1.85 MB`) installs via `pnpm add` in ~2 seconds without RPC timeouts.
 * - On first enable, `ensureSistersInstalledAsync()` streams missing 24fps WebM & PNG asset packs
 *   asynchronously from `registry.npmmirror.com` (Mainland China CDN) -> fallback `registry.npmjs.org`,
 *   verifying exact SHA-512 hashes before atomic extraction into `$DSH_HOME/dsh-pet/pet/`.
 * - When `pet/<id>-animation` already exists locally (git clone / offline zip), copies locally with 0 network calls.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_PACKS, ASSET_PACKS_VERSION } from './asset-packs.mjs';
import { extractSisterTgzToPetDir } from './tar-extract.mjs';

export const WAVE1_IDS = ['gemini', 'kimi', 'chatgpt', 'claude', 'grok', 'qwen', 'glm', 'doubao'];
export const WAVE2_IDS = ['yuanbao', 'nvidia', 'copilot', 'minimax', 'ernie', 'claude-fish', 'claude-opus', 'qwq'];
export const ALL_SISTER_IDS = [...WAVE1_IDS, ...WAVE2_IDS];

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(HERE, '..');

const PRESERVED_USER_KEYS = [
  'display',
  'size',
  'position',
  'fixedEnabled',
  'whisperEnabled',
  'balanceEnabled',
  'workStatusEnabled',
];

/**
 * Resolve `$DSH_HOME` across DeepSeek Harness Desktop, Web, and Standalone CLI.
 * If cwd is inside `<dshHome>/profiles/<profileName>`, automatically infers `<dshHome>`.
 */
export function resolveDshHomeDir(overrideHome = '') {
  if (overrideHome && overrideHome.trim()) return resolve(overrideHome.trim());
  if (process.env.DSH_HOME && process.env.DSH_HOME.trim()) return resolve(process.env.DSH_HOME.trim());

  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, '/');
  const m = normalized.match(/^(.*)\/profiles\/[^/]+\/?$/);
  if (m && m[1]) {
    return resolve(m[1]);
  }
  return join(homedir(), '.dsh');
}

/** Parse selection string (`'all'`, `'wave1'`, `'wave2'`, or `'gemini,claude,...'`). */
export function parseSelectedSisters(raw = 'all') {
  const val = String(raw ?? 'all').trim().toLowerCase();
  if (!val || val === 'all') return [...ALL_SISTER_IDS];
  if (val === 'wave1') return [...WAVE1_IDS];
  if (val === 'wave2') return [...WAVE2_IDS];
  const picked = val
    .split(',')
    .map((s) => s.trim())
    .filter((id) => ALL_SISTER_IDS.includes(id));
  return picked.length > 0 ? [...new Set(picked)] : [...ALL_SISTER_IDS];
}

function mergeConfigObjects(nextCfg, prevCfg) {
  const prevPet = Array.isArray(prevCfg?.pets) ? prevCfg.pets[0] : null;
  const nextPet = Array.isArray(nextCfg?.pets) ? nextCfg.pets[0] : null;
  if (prevPet && nextPet && prevPet.id === nextPet.id) {
    for (const key of PRESERVED_USER_KEYS) {
      if (prevPet[key] !== undefined) {
        nextPet[key] = prevPet[key];
      }
    }
  }
  return nextCfg;
}

/** Synchronous config merger (for local checkout / legacy callers). */
export function mergeSisterConfigPreservingUserPrefs(srcConfigPath, dstConfigPath) {
  const nextCfg = JSON.parse(readFileSync(srcConfigPath, 'utf8'));
  if (existsSync(dstConfigPath)) {
    try {
      const prevCfg = JSON.parse(readFileSync(dstConfigPath, 'utf8'));
      mergeConfigObjects(nextCfg, prevCfg);
    } catch {
      // Corrupted previous file; overwrite cleanly
    }
  }
  writeFileSync(dstConfigPath, JSON.stringify(nextCfg, null, 2) + '\n', 'utf8');
}

async function mergeSisterConfigAsync(srcConfigPath, dstConfigPath) {
  const nextCfg = JSON.parse(await readFile(srcConfigPath, 'utf8'));
  if (existsSync(dstConfigPath)) {
    try {
      const prevCfg = JSON.parse(await readFile(dstConfigPath, 'utf8'));
      mergeConfigObjects(nextCfg, prevCfg);
    } catch {
      // Corrupted previous file; overwrite cleanly
    }
  }
  await writeFile(dstConfigPath, JSON.stringify(nextCfg, null, 2) + '\n', 'utf8');
}

function isSisterMediaComplete(targetPetDir, id) {
  return (
    existsSync(join(targetPetDir, `${id}-config.json`)) &&
    existsSync(join(targetPetDir, `${id}-avatar.png`)) &&
    existsSync(join(targetPetDir, `${id}-animation`, '待机呼吸休闲.webm')) &&
    existsSync(join(targetPetDir, `${id}-animation`, '钻文件夹探头.webm')) &&
    existsSync(join(targetPetDir, `${id}-memes`, '元气问候.png'))
  );
}

async function fetchPackBufferWithFallback(pack, signal, logger) {
  let lastErr = null;
  for (const url of pack.urls) {
    if (signal?.aborted) throw new Error('Installation aborted');
    try {
      const timeoutSig = AbortSignal.timeout(120_000);
      const combinedSig = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;
      const res = await fetch(url, {
        headers: { 'user-agent': 'dsh-pet-ai-sisters-installer' },
        redirect: 'follow',
        signal: combinedSig,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      lastErr = err;
      logger?.warn?.(
        `[dsh-pet-ai-sisters] Mirror fallback for pack #${pack.id} (${url}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw lastErr ?? new Error(`All mirrors failed for asset pack #${pack.id}`);
}

/**
 * Non-blocking async installer used by `index.js` (`apply(ctx)`) and `bin/cli.mjs`.
 * Never blocks the DSH Host event loop; downloads missing media packs with SHA-512 verification.
 */
export async function ensureSistersInstalledAsync({
  pets = 'all',
  dshHome = '',
  force = false,
  signal = undefined,
  logger = console,
  onBatchInstalled = undefined,
} = {}) {
  const pkgJson = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const pkgVersion = String(pkgJson.version || '0.0.0');
  const selected = parseSelectedSisters(pets);
  const homeDir = resolveDshHomeDir(dshHome);
  const dshPetRoot = join(homeDir, 'dsh-pet');
  const targetPetDir = join(dshPetRoot, 'pet');
  const sourcePetDir = join(PACKAGE_ROOT, 'pet');

  await mkdir(targetPetDir, { recursive: true });
  const stampFile = join(targetPetDir, '.ai-sisters-manifest.json');
  const selectionKey = selected.slice().sort().join(',');

  if (!force && existsSync(stampFile)) {
    try {
      const stamp = JSON.parse(await readFile(stampFile, 'utf8'));
      const allReady = selected.every((id) => isSisterMediaComplete(targetPetDir, id));
      if (
        stamp.version === pkgVersion &&
        stamp.assetPacksVersion === ASSET_PACKS_VERSION &&
        stamp.selection === selectionKey &&
        allReady
      ) {
        return { skipped: true, version: pkgVersion, count: selected.length, targetPetDir, dshPetRoot };
      }
    } catch {
      // Re-sync if stamp unreadable
    }
  }

  // Check whether full animations exist locally in `PACKAGE_ROOT/pet/` (git checkout / offline zip)
  const hasLocalAnimations = selected.every((id) =>
    existsSync(join(sourcePetDir, `${id}-animation`, '待机呼吸休闲.webm')),
  );

  if (hasLocalAnimations) {
    for (const id of selected) {
      if (signal?.aborted) throw new Error('Aborted');
      for (const sub of [`${id}-animation`, `${id}-memes`]) {
        const srcSub = join(sourcePetDir, sub);
        const dstSub = join(targetPetDir, sub);
        await rm(dstSub, { recursive: true, force: true });
        await cp(srcSub, dstSub, { recursive: true, force: true });
      }
      await copyFile(join(sourcePetDir, `${id}-avatar.png`), join(targetPetDir, `${id}-avatar.png`));
      await mergeSisterConfigAsync(
        join(sourcePetDir, `${id}-config.json`),
        join(targetPetDir, `${id}-config.json`),
      );
    }
  } else {
    // Determine which remote asset packs are needed for missing/forced sisters
    const neededPacks = ASSET_PACKS.filter((pack) =>
      pack.sisters.some(
        (id) =>
          selected.includes(id) &&
          (force ||
            !existsSync(join(targetPetDir, `${id}-animation`, '待机呼吸休闲.webm')) ||
            !existsSync(join(targetPetDir, `${id}-memes`, '元气问候.png'))),
      ),
    );

    // Also update config & avatar immediately for any sister whose media is ALREADY cached on disk
    for (const id of selected) {
      if (
        !force &&
        existsSync(join(targetPetDir, `${id}-animation`, '待机呼吸休闲.webm')) &&
        existsSync(join(targetPetDir, `${id}-memes`, '元气问候.png'))
      ) {
        await copyFile(join(sourcePetDir, `${id}-avatar.png`), join(targetPetDir, `${id}-avatar.png`));
        await mergeSisterConfigAsync(
          join(sourcePetDir, `${id}-config.json`),
          join(targetPetDir, `${id}-config.json`),
        );
      }
    }

    // Download & extract needed asset packs (2 in parallel for optimal CDN throughput & memory)
    const concurrency = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < neededPacks.length) {
        const pack = neededPacks[cursor++];
        if (!pack || signal?.aborted) return;
        const wantedInPack = pack.sisters.filter((id) => selected.includes(id));
        logger?.info?.(
          `[dsh-pet-ai-sisters] Downloading asset pack #${pack.id} (${wantedInPack.join(', ')})...`,
        );
        const tgzBuf = await fetchPackBufferWithFallback(pack, signal, logger);
        await extractSisterTgzToPetDir(tgzBuf, targetPetDir, {
          expectedSha512Hex: pack.sha512Hex,
          selectedIds: wantedInPack,
        });
        for (const id of wantedInPack) {
          await copyFile(join(sourcePetDir, `${id}-avatar.png`), join(targetPetDir, `${id}-avatar.png`));
          await mergeSisterConfigAsync(
            join(sourcePetDir, `${id}-config.json`),
            join(targetPetDir, `${id}-config.json`),
          );
        }
        if (typeof onBatchInstalled === 'function') {
          await onBatchInstalled(wantedInPack, dshPetRoot);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, neededPacks.length) }, () => worker()),
    );
  }

  await writeFile(
    stampFile,
    JSON.stringify(
      {
        version: pkgVersion,
        assetPacksVersion: ASSET_PACKS_VERSION,
        selection: selectionKey,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  logger?.info?.(
    `[dsh-pet-ai-sisters] Ready: ${selected.length} AI Sisters (v${pkgVersion}) -> ${targetPetDir}`,
  );
  return { skipped: false, version: pkgVersion, count: selected.length, targetPetDir, dshPetRoot };
}

/**
 * Synchronous local sync helper (used when `pet/<id>-animation` is present locally in repo/zip).
 */
export function syncSistersToDshPet({
  pets = 'all',
  dshHome = '',
  force = false,
  logger = console,
} = {}) {
  const pkgJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const pkgVersion = String(pkgJson.version || '0.0.0');
  const selected = parseSelectedSisters(pets);
  const homeDir = resolveDshHomeDir(dshHome);
  const dshPetRoot = join(homeDir, 'dsh-pet');
  const targetPetDir = join(dshPetRoot, 'pet');
  const sourcePetDir = join(PACKAGE_ROOT, 'pet');

  mkdirSync(targetPetDir, { recursive: true });
  const stampFile = join(targetPetDir, '.ai-sisters-manifest.json');
  const selectionKey = selected.slice().sort().join(',');

  if (!force && existsSync(stampFile)) {
    try {
      const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
      const allReady = selected.every((id) => isSisterMediaComplete(targetPetDir, id));
      if (stamp.version === pkgVersion && stamp.selection === selectionKey && allReady) {
        return { skipped: true, version: pkgVersion, count: selected.length, targetPetDir, dshPetRoot };
      }
    } catch {
      // Re-sync
    }
  }

  for (const id of selected) {
    mergeSisterConfigPreservingUserPrefs(
      join(sourcePetDir, `${id}-config.json`),
      join(targetPetDir, `${id}-config.json`),
    );
    cpSync(join(sourcePetDir, `${id}-avatar.png`), join(targetPetDir, `${id}-avatar.png`), {
      force: true,
    });
    for (const sub of [`${id}-animation`, `${id}-memes`]) {
      const srcSub = join(sourcePetDir, sub);
      if (!existsSync(srcSub)) continue;
      const dstSub = join(targetPetDir, sub);
      if (existsSync(dstSub)) rmSync(dstSub, { recursive: true, force: true });
      cpSync(srcSub, dstSub, { recursive: true, force: true });
    }
  }

  writeFileSync(
    stampFile,
    JSON.stringify(
      {
        version: pkgVersion,
        assetPacksVersion: ASSET_PACKS_VERSION,
        selection: selectionKey,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  logger?.info?.(
    `[dsh-pet-ai-sisters] Installed/updated ${selected.length} AI Sisters (v${pkgVersion}) -> ${targetPetDir}`,
  );
  return { skipped: false, version: pkgVersion, count: selected.length, targetPetDir, dshPetRoot };
}

/** Discover running `dsh-pet` HTTP endpoint (`origin` + optional standalone `token`) from `$DSH_HOME/dsh-pet`. */
export function discoverDshPetEndpoint(dshPetRoot) {
  const runtimeFile = join(dshPetRoot, 'standalone-runtime.json');
  if (existsSync(runtimeFile)) {
    try {
      const info = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (info && info.port) {
        return { origin: `http://127.0.0.1:${info.port}`, token: String(info.token || '') };
      }
    } catch {
      // fall through
    }
  }

  const logFile = join(dshPetRoot, 'logs.txt');
  if (existsSync(logFile)) {
    try {
      const tail = readFileSync(logFile, 'utf8').slice(-32768);
      const matches = [...tail.matchAll(/http:\/\/127\.0\.0\.1:(\d+)/g)];
      if (matches.length > 0) {
        const port = matches[matches.length - 1][1];
        return { origin: `http://127.0.0.1:${port}`, token: '' };
      }
    } catch {
      // fall through
    }
  }
  return null;
}

/** Notify running `dsh-pet` instance to hot-reload its pet list if reachable. */
export async function notifyDshPetHotReload(dshPetRoot) {
  const ep = discoverDshPetEndpoint(dshPetRoot);
  if (!ep) return false;
  try {
    const headers = { host: new URL(ep.origin).host };
    if (ep.token) headers['x-dsh-pet-token'] = ep.token;
    const res = await fetch(`${ep.origin}/dsh-pet-7340/reload`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
