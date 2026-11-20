/**
 * Shared Pet Pack Installer & Smart Config Merger for `dsh-pet-ai-sisters`.
 * Used by both the DeepSeek Harness Cordis plugin (`index.js`) and standalone CLI (`bin/cli.mjs`).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WAVE1_IDS = ['gemini', 'kimi', 'chatgpt', 'claude', 'grok', 'qwen', 'glm', 'doubao'];
export const WAVE2_IDS = ['yuanbao', 'nvidia', 'copilot', 'minimax', 'ernie', 'claude-fish', 'claude-opus', 'qwq'];
export const ALL_SISTER_IDS = [...WAVE1_IDS, ...WAVE2_IDS];

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(HERE, '..');

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

/**
 * Merge incoming `<id>-config.json` while preserving any user-customized display settings
 * (`display`, `size`, `position`, `fixedEnabled`, `whisperEnabled`, `balanceEnabled`, `workStatusEnabled`).
 */
export function mergeSisterConfigPreservingUserPrefs(srcConfigPath, dstConfigPath) {
  const nextCfg = JSON.parse(readFileSync(srcConfigPath, 'utf8'));
  if (existsSync(dstConfigPath)) {
    try {
      const prevCfg = JSON.parse(readFileSync(dstConfigPath, 'utf8'));
      const prevPet = Array.isArray(prevCfg?.pets) ? prevCfg.pets[0] : null;
      const nextPet = Array.isArray(nextCfg?.pets) ? nextCfg.pets[0] : null;
      if (prevPet && nextPet && prevPet.id === nextPet.id) {
        for (const key of [
          'display',
          'size',
          'position',
          'fixedEnabled',
          'whisperEnabled',
          'balanceEnabled',
          'workStatusEnabled',
        ]) {
          if (prevPet[key] !== undefined) {
            nextPet[key] = prevPet[key];
          }
        }
      }
    } catch {
      // Corrupted previous file; overwrite cleanly with fresh config
    }
  }
  writeFileSync(dstConfigPath, JSON.stringify(nextCfg, null, 2) + '\n', 'utf8');
}

/**
 * Sync selected sisters from package `pet/` into `<dshHome>/dsh-pet/pet/`.
 * Uses `.ai-sisters-manifest.json` stamp so subsequent DSH startups skip redundant file copies (<2ms).
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

  if (!existsSync(sourcePetDir)) {
    throw new Error(`[dsh-pet-ai-sisters] Missing bundled pet/ directory at ${sourcePetDir}`);
  }

  mkdirSync(targetPetDir, { recursive: true });
  const stampFile = join(targetPetDir, '.ai-sisters-manifest.json');
  const selectionKey = selected.slice().sort().join(',');

  if (!force && existsSync(stampFile)) {
    try {
      const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
      const allConfigsExist = selected.every((id) =>
        existsSync(join(targetPetDir, `${id}-config.json`)),
      );
      if (stamp.version === pkgVersion && stamp.selection === selectionKey && allConfigsExist) {
        return { skipped: true, version: pkgVersion, count: selected.length, targetPetDir, dshPetRoot };
      }
    } catch {
      // Re-sync if stamp unreadable
    }
  }

  for (const id of selected) {
    const srcCfg = join(sourcePetDir, `${id}-config.json`);
    const dstCfg = join(targetPetDir, `${id}-config.json`);
    mergeSisterConfigPreservingUserPrefs(srcCfg, dstCfg);

    cpSync(join(sourcePetDir, `${id}-avatar.png`), join(targetPetDir, `${id}-avatar.png`), {
      force: true,
    });

    for (const sub of [`${id}-animation`, `${id}-memes`]) {
      const srcSub = join(sourcePetDir, sub);
      const dstSub = join(targetPetDir, sub);
      if (existsSync(dstSub)) {
        rmSync(dstSub, { recursive: true, force: true });
      }
      cpSync(srcSub, dstSub, { recursive: true, force: true });
    }
  }

  writeFileSync(
    stampFile,
    JSON.stringify(
      {
        version: pkgVersion,
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
