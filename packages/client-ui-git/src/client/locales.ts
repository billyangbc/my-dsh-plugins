/** `zifyaiGit` dictionaries for the Git panel. */
export const NS = 'zifyaiGit'

/** Simplified Chinese copy. */
export const zh = {
  'panel.refresh': '刷新',
  'panel.push': '推送',
  'panel.graph': '图形',
  'panel.load': '加载',
  'panel.loading': '加载中…',
  'panel.noCommits': '无提交',
  'panel.empty': '无',
  'panel.staged': '待提交',
  'panel.changed': '已更改',
  'panel.history': '提交历史',
  'panel.commit': '提交',
  'panel.commitPlaceholder': '提交说明',
  'panel.stage': '选入',
  'panel.unstage': '移出',
  'panel.working': '处理中…',
  'panel.stagedSuffix': ' (已暂存)',
  'panel.stageHunk': '选入此块',
  'panel.unstageHunk': '移出此块',
  'panel.discardHunk': '丢弃此块',
  'panel.discardConfirm': '丢弃 {path} 的此块改动？',
  'panel.committed': '已提交 {hash}',
  'panel.pushed': '已推送',
  'panel.nothingToPush': '没有需要推送的提交',
  'panel.stagedNotice': '待提交 ({count})',
  'panel.detached': '(detached)',
  'panel.title': 'Git',
  'panel.guide': '工作区变更、暂存与提交',
  'panel.notRepository': '当前工作区不是 Git 仓库。',
  'panel.pushRemote': '推送远程',
  'panel.historyTitle': '提交历史',
} satisfies Record<string, string>

/** Key union. */
export type GitKey = keyof typeof zh

/** English copy, checked against the zh key set. */
export const en = {
  'panel.refresh': 'Refresh',
  'panel.push': 'Push',
  'panel.graph': 'Graph',
  'panel.load': 'Load',
  'panel.loading': 'Loading…',
  'panel.noCommits': 'No commits',
  'panel.empty': 'None',
  'panel.staged': 'Staged',
  'panel.changed': 'Changed',
  'panel.history': 'History',
  'panel.commit': 'Commit',
  'panel.commitPlaceholder': 'Commit message',
  'panel.stage': 'Stage',
  'panel.unstage': 'Unstage',
  'panel.working': 'Working…',
  'panel.stagedSuffix': ' (staged)',
  'panel.stageHunk': 'Stage hunk',
  'panel.unstageHunk': 'Unstage hunk',
  'panel.discardHunk': 'Discard hunk',
  'panel.discardConfirm': 'Discard this hunk of {path}?',
  'panel.committed': 'Committed {hash}',
  'panel.pushed': 'Pushed',
  'panel.nothingToPush': 'Nothing to push',
  'panel.stagedNotice': 'Staged ({count})',
  'panel.detached': '(detached)',
  'panel.title': 'Git',
  'panel.guide': 'Review, stage, and commit workspace changes',
  'panel.notRepository': 'This workspace is not a Git repository.',
  'panel.pushRemote': 'Push remote',
  'panel.historyTitle': 'History',
} satisfies Record<GitKey, string>

/** Pick a dictionary from the browser language and interpolate params. */
export function translator(): (key: GitKey, params?: Record<string, string | number>) => string {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language
  const dictionary = language.toLowerCase().startsWith('en') ? en : zh
  return (key, params) => {
    const template = dictionary[key]
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
  }
}
