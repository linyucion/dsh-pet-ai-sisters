#!/usr/bin/env node
/**
 * One-line CLI installer for `dsh-pet-ai-sisters`:
 *   npx -y dsh-pet-ai-sisters@latest
 *   npx -y dsh-pet-ai-sisters@latest --pets wave1
 *   npx -y dsh-pet-ai-sisters@latest --pets gemini,claude,claude-fish
 */

import { ensureSistersInstalledAsync, notifyDshPetHotReload } from '../src/installer.mjs';

function parseCliArgs(argv) {
  let pets = 'all';
  let dshHome = '';
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--pets' || arg === '-p') && argv[i + 1]) {
      pets = argv[++i];
    } else if (arg === '--home' && argv[i + 1]) {
      dshHome = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npx dsh-pet-ai-sisters [--pets all|wave1|wave2|gemini,claude,...] [--home <dsh_home>]',
      );
      process.exit(0);
    }
  }
  return { pets, dshHome };
}

async function main() {
  const { pets, dshHome } = parseCliArgs(process.argv);
  const res = await ensureSistersInstalledAsync({ pets, dshHome, force: true, logger: console });
  const reloaded = await notifyDshPetHotReload(res.dshPetRoot);
  if (reloaded) {
    console.log('🎉 已通知正在运行的 dsh-pet 热重载配置，16 位姐妹马上登场！');
  } else {
    console.log(`✅ 安装完成 (${res.count} 位姐妹 -> ${res.targetPetDir})！打开或重载 dsh-pet 即可登场~`);
  }
}

main().catch((err) => {
  console.error('[dsh-pet-ai-sisters] 安装失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
