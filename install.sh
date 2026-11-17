#!/usr/bin/env bash
# One-click installer for dsh-pet AI Sisters Pack v4.0 (macOS / Linux)
# 将十六位社区知名人设二头身 Q 版 AI 姐妹满帧动画桌宠包一键安装到 DeepSeek Harness 的 dsh-pet 目录并自动热重载。

set -euo pipefail

PETS_ARG="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PET_DIR="${SCRIPT_DIR}/pet"
DSH_ROOT="${DSH_HOME:-${HOME}/.dsh}"
DSH_PET_DIR="${DSH_PET_DIR:-${DSH_ROOT}/dsh-pet}"
TARGET_PET_DIR="${DSH_PET_DIR}/pet"

WAVE1_IDS=("gemini" "kimi" "chatgpt" "claude" "grok" "qwen" "glm" "doubao")
WAVE2_IDS=("yuanbao" "nvidia" "copilot" "minimax" "ernie" "claude-fish" "claude-opus" "qwq")
ALL_IDS=("${WAVE1_IDS[@]}" "${WAVE2_IDS[@]}")

if [[ ! -d "${SOURCE_PET_DIR}" ]]; then
  echo "❌ 找不到源码 pet/ 目录: ${SOURCE_PET_DIR}" >&2
  exit 1
fi

mkdir -p "${TARGET_PET_DIR}"

SELECTED=()
LOWER_ARG="$(echo "${PETS_ARG}" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ "${LOWER_ARG}" == "all" || -z "${LOWER_ARG}" ]]; then
  SELECTED=("${ALL_IDS[@]}")
elif [[ "${LOWER_ARG}" == "wave1" ]]; then
  SELECTED=("${WAVE1_IDS[@]}")
elif [[ "${LOWER_ARG}" == "wave2" ]]; then
  SELECTED=("${WAVE2_IDS[@]}")
else
  IFS=',' read -ra REQ <<< "${PETS_ARG}"
  for r in "${REQ[@]}"; do
    clean="$(echo "${r}" | tr '[:upper:]' '[:lower:]' | xargs)"
    for valid in "${ALL_IDS[@]}"; do
      if [[ "${clean}" == "${valid}" ]]; then
        SELECTED+=("${clean}")
      fi
    done
  done
fi

if [[ "${#SELECTED[@]}" -eq 0 ]]; then
  echo "❌ 未匹配到有效宠物 ID。可选值: all, wave1, wave2, 或 ${ALL_IDS[*]}" >&2
  exit 1
fi

echo "🐾 正在安装 dsh-pet AI 姐妹宠物包 v4.0.0-beta.1 (${#SELECTED[@]} 位，Beta 测试版) -> ${TARGET_PET_DIR}"
for id in "${SELECTED[@]}"; do
  cp -f "${SOURCE_PET_DIR}/${id}-config.json" "${TARGET_PET_DIR}/"
  cp -f "${SOURCE_PET_DIR}/${id}-avatar.png" "${TARGET_PET_DIR}/"
  rm -rf "${TARGET_PET_DIR}/${id}-animation" "${TARGET_PET_DIR}/${id}-memes"
  cp -R "${SOURCE_PET_DIR}/${id}-animation" "${TARGET_PET_DIR}/${id}-animation"
  cp -R "${SOURCE_PET_DIR}/${id}-memes" "${TARGET_PET_DIR}/${id}-memes"
  echo "  ✨ 已安装: ${id}"
done

# Auto-detect running dsh-pet HTTP endpoint from logs.txt and trigger /reload
LOG_FILE="${DSH_PET_DIR}/logs.txt"
RELOADED=0
if [[ -f "${LOG_FILE}" ]] && command -v curl >/dev/null 2>&1; then
  BASE_URL="$(grep -Eo 'http://127\.0\.0\.1:[0-9]+/dsh-pet-[0-9]+' "${LOG_FILE}" | tail -n 1 || true)"
  if [[ -n "${BASE_URL}" ]]; then
    if curl -fsS -X POST "${BASE_URL}/reload" --max-time 5 >/dev/null 2>&1; then
      RELOADED=1
      echo "🎉 已通知正在运行的 DeepSeek Harness (dsh-pet) 热重载，姐妹们马上登场！"
    fi
  fi
fi

if [[ "${RELOADED}" -eq 0 ]]; then
  echo "✅ 文件已就绪！打开 DeepSeek Harness（或在 dsh-pet 面板点一次重载）即可召唤全部姐妹登场~"
fi
