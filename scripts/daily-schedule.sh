#!/usr/bin/env bash
#
# 每日自动化流程：生成 vlog → git push → 发布社交媒体
#
# 用法：
#   bash scripts/daily-schedule.sh [--topic "主题"]
#
# 环境变量要求（除社交媒体发布需要的外）：
#   GIT_USER_NAME     - Git 用户名
#   GIT_USER_EMAIL    - Git 邮箱
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_FILE="$PROJECT_DIR/daily-schedule.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

cd "$PROJECT_DIR"

log "============================================"
log "每日自动化流程开始"
log "============================================"

# ───────────────────────────────────────
# 步骤 1: 检查主题文件
# ───────────────────────────────────────
log "步骤 1/5: 检查主题文件..."

TOPIC_FILE="/tmp/poker-vlog-topic.txt"
if [[ -f "$TOPIC_FILE" ]]; then
  TOPIC_CONTENT=$(cat "$TOPIC_FILE" 2>/dev/null || true)
  if [[ -n "$TOPIC_CONTENT" ]]; then
    log "从 $TOPIC_FILE 读取到主题: $TOPIC_CONTENT"
  else
    log "$TOPIC_FILE 存在但为空，将使用内置随机主题"
  fi
else
  log "$TOPIC_FILE 不存在，将使用内置随机主题列表"
fi

# ───────────────────────────────────────
# 步骤 2: 生成新的 vlog
# ───────────────────────────────────────
log "步骤 2/5: 生成 vlog..."

VLOG_TOPIC=""
if [[ "${1:-}" == "--topic" ]] && [[ -n "${2:-}" ]]; then
  VLOG_TOPIC="--topic $2"
fi

if ! node scripts/generate-vlog.js $VLOG_TOPIC; then
  log_error "vlog 生成失败，流程终止"
  exit 1
fi

log "vlog 生成完成"

# ───────────────────────────────────────
# 步骤 3: 构建项目验证
# ───────────────────────────────────────
log "步骤 3/5: 构建项目验证..."

if ! npm run build 2>&1 | tee -a "$LOG_FILE"; then
  log_error "项目构建失败，请检查错误"
  exit 1
fi

log "构建验证通过"

# ───────────────────────────────────────
# 步骤 4: Git 提交和推送
# ───────────────────────────────────────
log "步骤 4/5: Git 提交和推送..."

if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  log "没有文件变更，跳过 git 提交"
else
  git add src/content/vlog/ dist/

  COMMIT_MSG="feat: daily vlog update $(date '+%Y-%m-%d')"
  git commit -m "$COMMIT_MSG" 2>&1 | tee -a "$LOG_FILE"

  # 尝试推送到 origin
  if git push origin HEAD 2>&1 | tee -a "$LOG_FILE"; then
    log "Git 推送成功"
  else
    log_error "Git 推送失败，社交媒体发布将继续进行"
  fi
fi

# ───────────────────────────────────────
# 步骤 5: 发布到社交媒体
# ───────────────────────────────────────
log "步骤 5/5: 发布社交媒体..."

if ! node scripts/publish-social.mjs 2>&1 | tee -a "$LOG_FILE"; then
  log_error "社交媒体发布过程中出现错误"
fi

log "============================================"
log "每日自动化流程完成"
log "============================================"
