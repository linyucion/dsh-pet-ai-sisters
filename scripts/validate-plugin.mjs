#!/usr/bin/env node
/**
 * Comprehensive DSH Bundle Manifest, Asset Integrity, Security & Lifecycle Validator
 * for `dsh-pet-ai-sisters`.
 *
 * Usage:
 *   node scripts/validate-plugin.mjs          # Static manifest + 272 WebM + security check
 *   node scripts/validate-plugin.mjs --test   # Also runs Cordis `apply(ctx)` + user-pref preservation test
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ALL_SISTER_IDS, PACKAGE_ROOT, syncSistersToDshPet } from '../src/installer.mjs';
import pluginEntry, { apply, name as exportedName } from '../index.js';

const REQUIRED_17_CLIPS = [
  '待机呼吸休闲',
  '东张西望',
  '点击回应-元气挥手',
  '点击回应-开心跃动',
  '招牌特技-个人秀',
  '认真写代码',
  '悠闲小憩摸鱼',
  '委屈叹气冒汗',
  '轻快小跑',
  '被鼠标拖拽悬空反馈',
  '睡觉-开始',
  '睡觉-循环',
  '睡觉-起来',
  '坐姿悠闲晃脚',
  '抱云朵小憩',
  '敲敲玻璃求关注',
  '钻文件夹探头',
];

function validateManifestAndPatch() {
  const pkgPath = join(PACKAGE_ROOT, 'package.json');
  assert.ok(existsSync(pkgPath), 'Missing package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  assert.equal(pkg.name, 'dsh-pet-ai-sisters', 'package.json name must be dsh-pet-ai-sisters');
  assert.equal(pkg.type, 'module', 'package.json must be ESM (type: module)');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'Missing dsh.bundle.patch');

  const iconPath = resolve(PACKAGE_ROOT, pkg.icon || 'icon.png');
  assert.ok(existsSync(iconPath), `Missing icon file: ${iconPath}`);
  const iconBytes = statSync(iconPath).size;
  assert.ok(iconBytes > 1000 && iconBytes <= 256 * 1024, `Icon must be <= 256 KiB (got ${iconBytes} B)`);

  const patchPath = join(PACKAGE_ROOT, 'cordis.patch.yml');
  assert.ok(existsSync(patchPath), 'Missing cordis.patch.yml');
  const patchText = readFileSync(patchPath, 'utf8');
  // DSH Store check requires `- id: dsh-pet-ai-sisters` with NO trailing inline comment on that line!
  assert.match(
    patchText,
    /^\s*-\s+id:\s+dsh-pet-ai-sisters\r?$/m,
    'cordis.patch.yml must have exact `- id: dsh-pet-ai-sisters` line without trailing comments',
  );

  assert.equal(exportedName, 'dsh-pet-ai-sisters');
  assert.equal(typeof apply, 'function');
  assert.equal(typeof pluginEntry.apply, 'function');
}

function validatePetAssets() {
  const petDir = join(PACKAGE_ROOT, 'pet');
  assert.ok(existsSync(petDir), 'Missing pet/ directory');

  const margins = new Set();
  let totalWebmBytes = 0;

  for (const id of ALL_SISTER_IDS) {
    const cfgPath = join(petDir, `${id}-config.json`);
    assert.ok(existsSync(cfgPath), `Missing ${id}-config.json`);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.pets?.[0]?.id, id, `${id}: config pet id mismatch`);
    margins.add(cfg.pets[0].position?.marginX);

    const avPath = join(petDir, `${id}-avatar.png`);
    assert.ok(existsSync(avPath) && statSync(avPath).size > 5000, `Missing/invalid ${id}-avatar.png`);

    for (const meme of ['元气问候', '可爱卖萌', '招牌得意', '委屈叹气']) {
      const mp = join(petDir, `${id}-memes`, `${meme}.png`);
      assert.ok(existsSync(mp) && statSync(mp).size > 5000, `Missing sticker ${id}/${meme}.png`);
    }

    for (const clip of REQUIRED_17_CLIPS) {
      const wp = join(petDir, `${id}-animation`, `${clip}.webm`);
      assert.ok(existsSync(wp), `Missing WebM ${id}/${clip}.webm`);
      const sz = statSync(wp).size;
      assert.ok(sz > 8000, `Tiny/corrupt WebM ${id}/${clip}.webm (${sz} B)`);
      totalWebmBytes += sz;
    }
  }

  assert.equal(margins.size, 16, 'All 16 sisters must have distinct non-overlapping marginX positions');
  console.log(
    `[validate] ✅ Verified 16 sisters × 17 clips (272 WebMs, ${(totalWebmBytes / 1024 / 1024).toFixed(2)} MB total)`,
  );
}

function scanDirectorySecurity(dir) {
  const forbidden = ['c:\\users', 'c:/users', 'linyucion\\.dsh', 'sk-', 'aliyun_token_plan', 'dashscope_api_key'];
  const textExts = new Set(['.md', '.json', '.js', '.mjs', '.yml', '.yaml', '.ps1', '.sh', '.bat']);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectorySecurity(full);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : '';
      if (!textExts.has(ext)) continue;
      if (entry.name === 'validate-plugin.mjs') continue;
      const content = readFileSync(full, 'utf8').toLowerCase().replaceAll('c:\\users\\<你的用户名>', '');
      for (const pat of forbidden) {
        assert.ok(!content.includes(pat), `Security scan failed: forbidden pattern "${pat}" in ${full}`);
      }
    }
  }
}

async function runLifecycleUnitTests() {
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh-sisters-test-'));
  try {
    // 1. Test selective wave1 sync + user preference preservation across upgrades
    const first = syncSistersToDshPet({ pets: 'gemini,claude', dshHome: tempHome, logger: null });
    assert.equal(first.skipped, false);
    assert.equal(first.count, 2);

    const geminiCfgPath = join(first.targetPetDir, 'gemini-config.json');
    const customCfg = JSON.parse(readFileSync(geminiCfgPath, 'utf8'));
    customCfg.pets[0].display = 'none';
    customCfg.pets[0].size = 380;
    writeFileSync(geminiCfgPath, JSON.stringify(customCfg, null, 2), 'utf8');

    // Second call without force skips via stamp (<2ms)
    const cached = syncSistersToDshPet({ pets: 'gemini,claude', dshHome: tempHome, logger: null });
    assert.equal(cached.skipped, true);

    // Forced upgrade preserves user's display='none' & size=380!
    syncSistersToDshPet({ pets: 'gemini,claude', dshHome: tempHome, force: true, logger: null });
    const afterUpgrade = JSON.parse(readFileSync(geminiCfgPath, 'utf8'));
    assert.equal(afterUpgrade.pets[0].display, 'none');
    assert.equal(afterUpgrade.pets[0].size, 380);

    // 2. Test Cordis `apply(ctx, config)` + clean effect disposal
    const disposers = [];
    const mockCtx = {
      logger: { info() {}, warn() {} },
      effect(setup) {
        const dispose = setup();
        if (typeof dispose === 'function') disposers.push(dispose);
      },
    };
    apply(mockCtx, { pets: 'gemini', dshHome: tempHome, enableDirector: false });
    assert.equal(disposers.length, 1);
    for (const d of disposers) d();
    console.log('[test] ✅ Cordis apply(ctx) + stamp cache + user preference preservation passed!');
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

async function main() {
  validateManifestAndPatch();
  validatePetAssets();
  scanDirectorySecurity(PACKAGE_ROOT);
  console.log('[validate] ✅ DSH bundle manifest, cordis.patch.yml & security scan clean!');

  if (process.argv.includes('--test')) {
    await runLifecycleUnitTests();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
