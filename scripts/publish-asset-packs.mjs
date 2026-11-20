#!/usr/bin/env node
/**
 * Builds, verifies, publishes, and syncs the 4 prebuilt media asset packs
 * (`@linyucion/dsh-pet-ai-sisters-pack-1` .. `pack-4`) to npmjs + npmmirror CDN,
 * then writes pinned SHA-512 manifests to `src/asset-packs.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSisterTgzToPetDir } from '../src/tar-extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PET_SRC = join(ROOT, 'pet');
const PACK_VERSION = process.env.ASSET_PACK_VERSION || '1.0.0';
const DRY_RUN = process.argv.includes('--dry-run');

export const PACK_DEFS = [
  { id: 1, pkg: '@linyucion/dsh-pet-ai-sisters-pack-1', sisters: ['gemini', 'kimi', 'chatgpt', 'claude'] },
  { id: 2, pkg: '@linyucion/dsh-pet-ai-sisters-pack-2', sisters: ['grok', 'qwen', 'glm', 'doubao'] },
  { id: 3, pkg: '@linyucion/dsh-pet-ai-sisters-pack-3', sisters: ['claude-fish', 'claude-opus', 'qwq', 'yuanbao'] },
  { id: 4, pkg: '@linyucion/dsh-pet-ai-sisters-pack-4', sisters: ['nvidia', 'copilot', 'minimax', 'ernie'] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForNpmVersion(pkgName, expectedVer) {
  const encoded = pkgName.startsWith('@')
    ? '@' + encodeURIComponent(pkgName.slice(1))
    : encodeURIComponent(pkgName);
  for (let attempt = 1; attempt <= 120; attempt++) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${encoded}?t=${Date.now()}`, {
        headers: { 'cache-control': 'no-cache' },
      });
      if (res.ok) {
        const j = await res.json();
        const verDoc = j?.versions?.[expectedVer];
        if (verDoc && j?.['dist-tags']?.latest === expectedVer) {
          return verDoc;
        }
      }
    } catch {
      // retry
    }
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for ${pkgName}@${expectedVer} on registry.npmjs.org`);
}

async function syncNpmMirror(pkgName, expectedVer) {
  const plainPath = pkgName; // npmmirror accepts `/@scope/name` directly
  for (let round = 1; round <= 8; round++) {
    try {
      const putRes = await fetch(`https://registry-direct.npmmirror.com/${plainPath}/sync`, {
        method: 'PUT',
      });
      const putJson = await putRes.json().catch(() => ({}));
      const logId = putJson?.logId;
      if (logId) {
        for (let poll = 0; poll < 25; poll++) {
          await sleep(2500);
          const pollRes = await fetch(
            `https://registry-direct.npmmirror.com/${plainPath}/sync/log/${logId}`,
          );
          const pollJson = await pollRes.json().catch(() => ({}));
          if (pollJson?.syncDone) break;
        }
      }
      const checkRes = await fetch(`https://registry.npmmirror.com/${plainPath}`, {
        headers: { 'cache-control': 'no-cache' },
      });
      if (checkRes.ok) {
        const doc = await checkRes.json();
        const meta = doc?.versions?.[expectedVer];
        if (meta && doc?.['dist-tags']?.latest === expectedVer) {
          console.log(`   ✓ npmmirror synced ${pkgName}@${expectedVer} -> ${meta.dist?.tarball}`);
          return meta;
        }
      }
    } catch (err) {
      console.warn(`   ! npmmirror sync attempt ${round} warning:`, err.message);
    }
    await sleep(3000);
  }
  throw new Error(`npmmirror failed to sync ${pkgName}@${expectedVer}`);
}

async function main() {
  const npmToken = process.env.NPM_TOKEN || '';
  if (!DRY_RUN && !npmToken) {
    throw new Error('NPM_TOKEN env var is required unless --dry-run is passed');
  }

  const workBase = mkdtempSync(join(tmpdir(), 'ai-sisters-packs-'));
  const cleanNpmrc = join(workBase, '.npmrc');
  writeFileSync(
    cleanNpmrc,
    npmToken ? `//registry.npmjs.org/:_authToken=${npmToken}\nregistry=https://registry.npmjs.org/\n` : 'registry=https://registry.npmjs.org/\n',
    'utf8',
  );

  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: cleanNpmrc,
    NPM_CONFIG_PROXY: '',
    NPM_CONFIG_HTTPS_PROXY: '',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
  };

  const manifestEntries = [];

  try {
    for (const def of PACK_DEFS) {
      console.log(`\n=== Building ${def.pkg}@${PACK_VERSION} (${def.sisters.join(', ')}) ===`);
      const pkgDir = join(workBase, `pack-${def.id}`);
      const petOut = join(pkgDir, 'pet');
      mkdirSync(petOut, { recursive: true });

      for (const id of def.sisters) {
        cpSync(join(PET_SRC, `${id}-animation`), join(petOut, `${id}-animation`), { recursive: true });
        cpSync(join(PET_SRC, `${id}-memes`), join(petOut, `${id}-memes`), { recursive: true });
      }

      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify(
          {
            name: def.pkg,
            version: PACK_VERSION,
            description: `Prebuilt 24fps WebM animation & sticker asset pack #${def.id} (${def.sisters.join(', ')}) for dsh-pet-ai-sisters`,
            license: 'MIT',
            author: 'linyucion',
            repository: {
              type: 'git',
              url: 'git+https://github.com/linyucion/dsh-pet-ai-sisters.git',
              directory: 'pet',
            },
            files: ['pet/'],
            publishConfig: { access: 'public' },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      writeFileSync(
        join(pkgDir, 'README.md'),
        `# ${def.pkg}\n\nAsset pack #${def.id} (${def.sisters.join(', ')}) for [\`dsh-pet-ai-sisters\`](https://github.com/linyucion/dsh-pet-ai-sisters).\n`,
        'utf8',
      );

      const tgzName = execFileSync(npmBin, ['pack', '--quiet'], {
        cwd: pkgDir,
        env,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      }).trim();
      const tgzPath = join(pkgDir, tgzName);
      const tgzBuf = readFileSync(tgzPath);
      const sha512Hex = createHash('sha512').update(tgzBuf).digest('hex');
      console.log(`   Packed ${tgzName} (${(tgzBuf.length / 1048576).toFixed(2)} MB, sha512=${sha512Hex.slice(0, 16)}...)`);

      // Verify byte-exact round-trip extraction including CJK filenames!
      const verifyDir = join(workBase, `verify-${def.id}`);
      const extracted = await extractSisterTgzToPetDir(tgzBuf, verifyDir, {
        expectedSha512Hex: sha512Hex,
      });
      for (const id of def.sisters) {
        if (!extracted.includes(id)) throw new Error(`Missing extracted sister ${id}`);
        const animCount = readdirSync(join(verifyDir, `${id}-animation`)).filter((f) => f.endsWith('.webm')).length;
        const memeCount = readdirSync(join(verifyDir, `${id}-memes`)).filter((f) => f.endsWith('.png')).length;
        if (animCount !== 17 || memeCount !== 4) {
          throw new Error(`Count mismatch for ${id}: anim=${animCount}, meme=${memeCount}`);
        }
      }
      console.log(`   ✓ Verified PAX/UTF-8 extraction: ${def.sisters.length} sisters (68 WebMs + 16 PNGs)`);

      const shortName = def.pkg.split('/')[1];
      let finalSha512 = sha512Hex;

      if (!DRY_RUN) {
        // Check if already published at this exact version
        let already = false;
        try {
          const encoded = '@' + encodeURIComponent(def.pkg.slice(1));
          const check = await fetch(`https://registry.npmjs.org/${encoded}`);
          if (check.ok) {
            const j = await check.json();
            if (j?.versions?.[PACK_VERSION] || j?.['dist-tags']?.latest === '0.0.0-stage') already = true;
          }
        } catch {
          // ignore
        }

        if (!already) {
          console.log(`   Publishing ${def.pkg}@${PACK_VERSION} to npmjs.org...`);
          execFileSync(npmBin, ['publish', tgzPath, '--access', 'public'], {
            cwd: pkgDir,
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32',
          });
        } else {
          console.log(`   Already uploaded to npmjs.org: ${def.pkg}@${PACK_VERSION}`);
        }
      }

      manifestEntries.push({
        id: def.id,
        pkg: def.pkg,
        version: PACK_VERSION,
        sisters: def.sisters,
        sha512Hex: finalSha512,
        urls: [
          `https://registry.npmmirror.com/${def.pkg}/-/${shortName}-${PACK_VERSION}.tgz`,
          `https://registry.npmjs.org/${def.pkg}/-/${shortName}-${PACK_VERSION}.tgz`,
        ],
      });
    }

    if (!DRY_RUN) {
      console.log('\n=== Waiting in parallel for npmjs indexing + syncing all 4 packs to npmmirror ===');
      await Promise.all(
        manifestEntries.map(async (entry) => {
          const npmMeta = await waitForNpmVersion(entry.pkg, PACK_VERSION);
          console.log(`   ✓ npmjs live: ${entry.pkg}@${PACK_VERSION}`);
          if (npmMeta?.dist?.integrity?.startsWith('sha512-')) {
            const b64 = npmMeta.dist.integrity.slice('sha512-'.length);
            entry.sha512Hex = Buffer.from(b64, 'base64').toString('hex');
          }
          await syncNpmMirror(entry.pkg, PACK_VERSION);
        }),
      );
    }

    const outCode = `/**
 * Pinned SHA-512 verified asset pack manifest for \`dsh-pet-ai-sisters\`.
 * Generated by \`scripts/publish-asset-packs.mjs\`.
 */

export const ASSET_PACKS_VERSION = ${JSON.stringify(PACK_VERSION)};

export const ASSET_PACKS = ${JSON.stringify(manifestEntries, null, 2)};
`;
    writeFileSync(join(ROOT, 'src', 'asset-packs.mjs'), outCode, 'utf8');
    console.log('\n✅ Wrote src/asset-packs.mjs successfully!');
  } finally {
    rmSync(workBase, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n❌ Asset pack publish failed:', err);
  process.exit(1);
});
