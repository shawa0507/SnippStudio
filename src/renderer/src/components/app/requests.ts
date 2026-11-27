// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a part of the window asks of the app shell (SnippStudio phase 9b):
// the empty states' buttons (import, export, open the templates), the tour
// and the sample project from the File menu's Help part. The shell (App.tsx)
// and the dock (WorkspaceDock.tsx) listen; a part does not need their props.
export type ShellRequest = 'import' | 'export' | 'dock:templates' | 'dock:text' | 'dock:filters' | 'dock:captions' | 'dock:voiceover' | 'inspector:open' | 'tour' | 'sample' | 'restart'

const EVENT = 'snipp:shell-request'

export function requestShell(what: ShellRequest): void {
  window.dispatchEvent(new CustomEvent<ShellRequest>(EVENT, { detail: what }))
}

/** Listens for the requests; returns the way to stop. */
export function onShellRequest(fn: (what: ShellRequest) => void): () => void {
  const on = (e: Event): void => fn((e as CustomEvent<ShellRequest>).detail)
  window.addEventListener(EVENT, on)
  return () => window.removeEventListener(EVENT, on)
}
