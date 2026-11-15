/** `zifyaiEditor` copy for the editor panel. */
export type EditorKey =
  | 'title' | 'guide' | 'workspace' | 'newFile' | 'newFolder' | 'refresh' | 'empty'
  | 'save' | 'rename' | 'remove' | 'preview' | 'edit' | 'send'
  | 'sent' | 'saved' | 'renamed' | 'deleted' | 'tooLarge'
  | 'closeConfirm' | 'closeTab'
  | 'newFileName' | 'newFolderName' | 'renamePrompt' | 'deleteConfirm'
  | 'sendContext' | 'sendSelection' | 'diagnosticsPending'

const zh: Record<EditorKey, string> = {
  title: '编辑器',
  guide: '浏览并编辑工作区文件',
  workspace: '工作区',
  newFile: '新建文件',
  newFolder: '新建文件夹',
  refresh: '刷新',
  empty: '从左侧选择文件开始编辑。',
  save: '保存',
  rename: '重命名',
  remove: '删除',
  preview: '预览',
  edit: '编辑',
  send: '发送到对话',
  sent: '已发送到对话',
  saved: '已保存 {path}',
  renamed: '已重命名 {path}',
  deleted: '已删除 {path}',
  tooLarge: '文件过大（{mb} MB），已拒绝在编辑器中打开。',
  closeConfirm: '未保存，仍要关闭 {path}？',
  closeTab: '关闭 {path}',
  newFileName: '新文件名',
  newFolderName: '新文件夹名',
  renamePrompt: '新名称',
  deleteConfirm: '删除 {path}？',
  sendContext: '请查看 @{path}',
  sendSelection: '请查看 @{path} 第 {line} 行附近：\n> {quote}',
  diagnosticsPending: '语言服务器尚未返回诊断。',
}

const en: Record<EditorKey, string> = {
  title: 'Editor',
  guide: 'Browse and edit workspace files',
  workspace: 'Workspace',
  newFile: 'New file',
  newFolder: 'New folder',
  refresh: 'Refresh',
  empty: 'Select a file on the left to start editing.',
  save: 'Save',
  rename: 'Rename',
  remove: 'Delete',
  preview: 'Preview',
  edit: 'Edit',
  send: 'Send to chat',
  sent: 'Sent to chat',
  saved: 'Saved {path}',
  renamed: 'Renamed {path}',
  deleted: 'Deleted {path}',
  tooLarge: 'File is too large ({mb} MB); refusing to open it.',
  closeConfirm: 'Discard unsaved changes in {path}?',
  closeTab: 'Close {path}',
  newFileName: 'New file name',
  newFolderName: 'New folder name',
  renamePrompt: 'New name',
  deleteConfirm: 'Delete {path}?',
  sendContext: 'Please look at @{path}',
  sendSelection: 'Please look at @{path} near line {line}:\n> {quote}',
  diagnosticsPending: 'The language server has not reported diagnostics yet.',
}

/** Translate editor copy by browser language. */
export function translator(): (key: EditorKey, params?: Record<string, string | number>) => string {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language
  const dictionary = language.toLowerCase().startsWith('en') ? en : zh
  return (key, params) => {
    const template = dictionary[key]
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (match, name: string) => String(params[name] ?? match))
  }
}
