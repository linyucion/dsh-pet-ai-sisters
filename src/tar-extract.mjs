/**
 * Pure Node.js async `.tgz` integrity verifier & PAX/USTAR extractor for `dsh-pet-ai-sisters`.
 * Zero external dependencies; handles UTF-8 / CJK filenames via PAX extended headers (`typeflag === 'x'`).
 * Strictly whitelists `<id>-animation/*.webm` and `<id>-memes/*.png` to guarantee safe extraction.
 */

import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);

const ALLOWED_REL_PATH = /^([a-z0-9-]+)-(animation\/[^/]+\.webm|memes\/[^/]+\.png)$/;

function readNullTermString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return (zero === -1 ? slice : slice.subarray(0, zero)).toString('utf8');
}

function parseOctal(buf, start, length) {
  // Handle base-256 (binary) tar size encoding if high bit set
  if ((buf[start] & 0x80) !== 0) {
    let val = 0n;
    for (let i = start + 1; i < start + length; i++) {
      val = (val << 8n) | BigInt(buf[i]);
    }
    return Number(val);
  }
  const raw = readNullTermString(buf, start, length).trim();
  return raw ? parseInt(raw, 8) : 0;
}

function parsePaxRecords(buf) {
  const attrs = {};
  let offset = 0;
  while (offset < buf.length) {
    const spaceIdx = buf.indexOf(0x20, offset);
    if (spaceIdx === -1) break;
    const lenStr = buf.subarray(offset, spaceIdx).toString('ascii');
    const recLen = parseInt(lenStr, 10);
    if (!Number.isFinite(recLen) || recLen <= 0 || offset + recLen > buf.length) break;
    const record = buf.subarray(spaceIdx + 1, offset + recLen - 1).toString('utf8');
    const eqIdx = record.indexOf('=');
    if (eqIdx !== -1) {
      attrs[record.slice(0, eqIdx)] = record.slice(eqIdx + 1);
    }
    offset += recLen;
  }
  return attrs;
}

/**
 * Parse a gunzipped tar buffer and return Map<sisterId, Array<{ relSubPath, data }>>
 * filtered strictly to allowed `<id>-animation/*.webm` and `<id>-memes/*.png` entries.
 */
export function parseSisterTarBuffer(tarBuf, allowedSisterIds = null) {
  const allowedSet = allowedSisterIds ? new Set(allowedSisterIds) : null;
  const bySister = new Map();

  let offset = 0;
  let paxPath = null;
  let gnuLongPath = null;

  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    offset += 512;

    // End-of-archive zero block
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const size = parseOctal(header, 124, 12);
    const typeFlagChar = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const dataStart = offset;
    const dataEnd = dataStart + size;
    if (dataEnd > tarBuf.length) {
      throw new Error('Truncated tar archive entry');
    }
    const alignedAdvance = Math.ceil(size / 512) * 512;
    offset += alignedAdvance;

    if (typeFlagChar === 'x') {
      const pax = parsePaxRecords(tarBuf.subarray(dataStart, dataEnd));
      if (typeof pax.path === 'string') paxPath = pax.path;
      continue;
    }
    if (typeFlagChar === 'L') {
      gnuLongPath = readNullTermString(tarBuf, dataStart, size);
      continue;
    }
    if (typeFlagChar === 'g') {
      continue;
    }

    const name = readNullTermString(header, 0, 100);
    const prefix = readNullTermString(header, 345, 155);
    const fullEntryPath =
      paxPath ?? gnuLongPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    gnuLongPath = null;

    if (typeFlagChar !== '0') continue;

    // Normalize POSIX path and strip `package/pet/` prefix
    const normalized = posix.normalize(fullEntryPath.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (normalized.includes('..') || normalized.includes('\0')) continue;

    const stripped = normalized.startsWith('package/pet/')
      ? normalized.slice('package/pet/'.length)
      : normalized.startsWith('pet/')
        ? normalized.slice('pet/'.length)
        : null;
    if (!stripped) continue;

    const m = ALLOWED_REL_PATH.exec(stripped);
    if (!m) continue;

    const sisterId = m[1];
    if (allowedSet && !allowedSet.has(sisterId)) continue;

    let list = bySister.get(sisterId);
    if (!list) {
      list = [];
      bySister.set(sisterId, list);
    }
    list.push({
      relSubPath: stripped, // e.g. `gemini-animation/待机呼吸休闲.webm`
      data: tarBuf.subarray(dataStart, dataEnd),
    });
  }

  return bySister;
}

/**
 * Verify `.tgz` SHA-512 (when provided), gunzip asynchronously, and atomically extract
 * selected sisters' `<id>-animation` & `<id>-memes` directories into `targetPetDir`.
 */
export async function extractSisterTgzToPetDir(tgzBuf, targetPetDir, {
  expectedSha512Hex = '',
  selectedIds = null,
} = {}) {
  if (expectedSha512Hex) {
    const actual = createHash('sha512').update(tgzBuf).digest('hex');
    if (actual !== expectedSha512Hex.toLowerCase()) {
      throw new Error(
        `Asset pack SHA-512 mismatch (expected ${expectedSha512Hex.slice(0, 16)}..., got ${actual.slice(0, 16)}...)`,
      );
    }
  }

  const tarBuf = await gunzipAsync(tgzBuf);
  const bySister = parseSisterTarBuffer(tarBuf, selectedIds);
  const extractedIds = [];

  await mkdir(targetPetDir, { recursive: true });

  for (const [sisterId, files] of bySister.entries()) {
    const animStage = join(targetPetDir, `.tmp-${sisterId}-animation-${process.pid}`);
    const memeStage = join(targetPetDir, `.tmp-${sisterId}-memes-${process.pid}`);
    await rm(animStage, { recursive: true, force: true });
    await rm(memeStage, { recursive: true, force: true });
    await mkdir(animStage, { recursive: true });
    await mkdir(memeStage, { recursive: true });

    for (const { relSubPath, data } of files) {
      const slash = relSubPath.indexOf('/');
      const folder = relSubPath.slice(0, slash);
      const fileName = relSubPath.slice(slash + 1);
      const dstFile =
        folder === `${sisterId}-animation`
          ? join(animStage, fileName)
          : join(memeStage, fileName);
      await mkdir(dirname(dstFile), { recursive: true });
      await writeFile(dstFile, data);
    }

    const animFinal = join(targetPetDir, `${sisterId}-animation`);
    const memeFinal = join(targetPetDir, `${sisterId}-memes`);
    await rm(animFinal, { recursive: true, force: true });
    await rm(memeFinal, { recursive: true, force: true });
    await rename(animStage, animFinal);
    await rename(memeStage, memeFinal);
    extractedIds.push(sisterId);
  }

  return extractedIds;
}
