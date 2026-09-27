// reprise-workbench.js — browser shell for the static Reprise IDE (loaded by reprise-boot.js)
//
// The Code - OSS `web` build target ships only the embeddable workbench
// (out/vs/workbench/workbench.web.main.internal.js). The shell that normally
// wraps it (src/vs/code/browser/workbench/workbench.ts) is only built for the
// server. This file is the part of that shell a static host needs: the
// workspace provider that keeps the opened folder in the URL (?folder=…), and
// secret storage.
//
// Differences from workbench.ts:
//   - Secret storage. Without a server key, workbench.ts would keep secrets in
//     localStorage in plain text (TransparentCrypto), which browser-runtime.md
//     does not allow. Here secrets are AES-GCM encrypted in IndexedDB under a
//     non-extractable key that also lives in IndexedDB (see IndexedDBSecretStorageProvider).
//   - No urlCallbackProvider (only used by OAuth redirects; Reprise uses token entry, PD-23).

import { create, URI } from './out/vs/workbench/workbench.web.main.internal.js';

// ── Secret storage ────────────────────────────────────────────────────────────
//
// Protects secrets at rest: storage dumps and devtools show only ciphertext, and
// the key cannot be exported. It does not protect against script running in this
// origin, which can ask the browser to decrypt (security.md T10).

const SECRETS_DB = 'reprise-secrets';
const KEY_STORE = 'keys';
const SECRET_STORE = 'secrets';

function openSecretsDb() {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(SECRETS_DB, 1);
		open.onupgradeneeded = () => {
			open.result.createObjectStore(KEY_STORE);
			open.result.createObjectStore(SECRET_STORE);
		};
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
}

function transact(db, store, mode, operation) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, mode);
		const request = operation(tx.objectStore(store));
		tx.oncomplete = () => resolve(request.result);
		tx.onerror = tx.onabort = () => reject(tx.error);
	});
}

class IndexedDBSecretStorageProvider {
	type = 'persisted';

	#db = openSecretsDb();
	#key = this.#db.then(async db => {
		const existing = await transact(db, KEY_STORE, 'readonly', store => store.get('aes-gcm'));
		if (existing) {
			return existing;
		}
		const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
		await transact(db, KEY_STORE, 'readwrite', store => store.put(key, 'aes-gcm'));
		return key;
	});

	async get(name) {
		const entry = await transact(await this.#db, SECRET_STORE, 'readonly', store => store.get(name));
		if (!entry) {
			return undefined;
		}
		try {
			const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv }, await this.#key, entry.data);
			return new TextDecoder().decode(plain);
		} catch {
			return undefined; // written under another key; the user signs in again
		}
	}

	async set(name, value) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.#key, new TextEncoder().encode(value));
		await transact(await this.#db, SECRET_STORE, 'readwrite', store => store.put({ iv, data }, name));
	}

	async delete(name) {
		await transact(await this.#db, SECRET_STORE, 'readwrite', store => store.delete(name));
	}

	async keys() {
		return transact(await this.#db, SECRET_STORE, 'readonly', store => store.getAllKeys());
	}
}

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
	// Without IndexedDB the workbench keeps secrets in memory until reload
	secretStorageProvider: globalThis.indexedDB && crypto.subtle ? new IndexedDBSecretStorageProvider() : undefined,
});
