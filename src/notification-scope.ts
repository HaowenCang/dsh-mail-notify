/** Workspace/session exclusions shared by all automatic notification policies. */
import { posix, win32 } from 'node:path'
import type { PolicyConfig, SuppressionReason } from './types.ts'

export interface NotificationScope {
  sessionId: string
  cwd?: string
}

/** Normalize path spelling without accessing the filesystem or resolving links. */
function workspaceKey(value: string): string | undefined {
  const path = value
  if (path === '') return undefined
  const windows = /^[a-z]:[\\/]|^[\\/]{2}/i.test(path)
  const api = windows ? win32 : posix
  if (!api.isAbsolute(path)) return undefined
  const normalized = api.normalize(path)
  const root = api.parse(normalized).root
  const trailingSeparator = windows ? /[\\/]+$/ : /\/+$/
  const key = normalized.length > root.length ? normalized.replace(trailingSeparator, '') : normalized
  return windows ? `windows:${key.toLowerCase()}` : `posix:${key}`
}

/** Exact scope match. No prefix, parent-session, glob, or filesystem matching. */
export function scopeSuppression(scope: NotificationScope | undefined, policy: PolicyConfig): SuppressionReason | undefined {
  if (scope === undefined) return undefined
  if (policy.mutedSessions.some((id) => id.trim() !== '' && id.trim() === scope.sessionId)) return 'session-muted'
  const cwd = scope.cwd === undefined ? undefined : workspaceKey(scope.cwd)
  if (cwd !== undefined && policy.mutedWorkspaces.some((path) => workspaceKey(path.trim()) === cwd)) return 'workspace-muted'
  return undefined
}
