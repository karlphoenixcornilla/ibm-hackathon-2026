// reprise-workbench.js — browser shell for the static Reprise IDE (loaded by reprise-boot.js)
//
// The Code - OSS `web` build target ships only the embeddable workbench
// (out/vs/workbench/workbench.web.main.internal.js). The shell that normally
// wraps it (src/vs/code/browser/workbench/workbench.ts) is only built for the
// server. This file is the part of that shell a static host needs: the
// workspace provider that keeps the opened folder in the URL (?folder=…).
//
// Differences from workbench.ts:
//   - No secretStorageProvider. Without a server key, workbench.ts would keep
//     secrets in localStorage in plain text (TransparentCrypto), which
//     browser-runtime.md does not allow; the workbench falls back to in-memory
//     secret storage, so the GitHub token and runner pairing last until reload.
//   - No urlCallbackProvider (only used by OAuth redirects; Reprise uses token entry, PD-23).

import { create, URI } from './out/vs/workbench/workbench.web.main.internal.js';

const QUERY_PARAM_EMPTY_WINDOW = 'ew';
const QUERY_PARAM_FOLDER = 'folder';
const QUERY_PARAM_WORKSPACE = 'workspace';
const QUERY_PARAM_PAYLOAD = 'payload';

function pageUrl() {
	return `${document.location.origin}${document.location.pathname}`;
}

function workspaceFromUrl() {
	let workspace;
	let payload = Object.create(null);
	new URL(document.location.href).searchParams.forEach((value, key) => {
		switch (key) {
			case QUERY_PARAM_FOLDER:
				workspace = { folderUri: URI.parse(value) };
				break;
			case QUERY_PARAM_WORKSPACE:
				workspace = { workspaceUri: URI.parse(value) };
				break;
			case QUERY_PARAM_EMPTY_WINDOW:
				workspace = undefined;
				break;
			case QUERY_PARAM_PAYLOAD:
				try {
					payload = JSON.parse(value);
				} catch (error) {
					console.error(error);
				}
				break;
		}
	});
	return { workspace, payload };
}

function sameUri(a, b) {
	return !!a && !!b && a.toString() === b.toString();
}

function isSameWorkspace(a, b) {
	if (!a || !b) {
		return a === b;
	}
	return sameUri(a.folderUri, b.folderUri) || sameUri(a.workspaceUri, b.workspaceUri);
}

function targetUrl(workspace, payload) {
	let href;
	if (!workspace) {
		href = `${pageUrl()}?${QUERY_PARAM_EMPTY_WINDOW}=true`;
	} else if (workspace.folderUri) {
		href = `${pageUrl()}?${QUERY_PARAM_FOLDER}=${encodeURIComponent(workspace.folderUri.toString(true))}`;
	} else {
		href = `${pageUrl()}?${QUERY_PARAM_WORKSPACE}=${encodeURIComponent(workspace.workspaceUri.toString(true))}`;
	}
	if (payload) {
		href += `&${QUERY_PARAM_PAYLOAD}=${encodeURIComponent(JSON.stringify(payload))}`;
	}
	return href;
}

const current = workspaceFromUrl();

const workspaceProvider = {
	workspace: current.workspace,
	payload: current.payload,
	trusted: undefined, // let the workbench ask (enableWorkspaceTrust)
	async open(workspace, options) {
		if (options?.reuse && !options.payload && isSameWorkspace(current.workspace, workspace)) {
			return true;
		}
		const href = targetUrl(workspace, options?.payload);
		if (options?.reuse) {
			window.location.href = href;
			return true;
		}
		return !!window.open(href);
	},
};

const configuration = JSON.parse(document.getElementById('vscode-workbench-web-configuration').getAttribute('data-settings'));

create(document.body, {
	...configuration,
	windowIndicator: { label: '$(beaker) Reprise', tooltip: 'Reprise IDE' },
	workspaceProvider,
});
