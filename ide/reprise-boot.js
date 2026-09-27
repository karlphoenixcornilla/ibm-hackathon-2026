// reprise-boot.js — startup for the static Reprise IDE page (ide/index.html)
//
// Does what the Code - OSS server does when it renders workbench.html, so the
// web build can be served from any static path (GitHub Pages /ide/, or a local
// http server):
//   1. Supported-browser check (docs/kit/02-specs/browser-runtime.md).
//   2. Workbench configuration meta tag, read by out/vs/code/browser/workbench/workbench.js.
//   3. _VSCODE_FILE_ROOT, then the NLS messages and the workbench modules, in order.

(function () {
	'use strict';

	performance.mark('code/didStartRenderer');

	if (!window.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
		document.documentElement.classList.add('reprise-unsupported');
		return;
	}

	// Directory of this page without the trailing slash, e.g. https://owner.github.io/repo/ide
	var baseUrl = new URL('.', window.location.href).href.replace(/\/$/, '');
	var basePath = new URL(baseUrl).pathname;

	var configuration = {
		productConfiguration: { embedderIdentifier: 'reprise-ide' },
		enableWorkspaceTrust: true,
		callbackRoute: basePath + '/callback'
	};

	var meta = document.createElement('meta');
	meta.id = 'vscode-workbench-web-configuration';
	meta.setAttribute('data-settings', JSON.stringify(configuration));
	document.head.appendChild(meta);

	globalThis._VSCODE_FILE_ROOT = baseUrl + '/out/';

	function loadModule(src, onload) {
		var script = document.createElement('script');
		script.type = 'module';
		script.src = baseUrl + '/' + src;
		if (onload) {
			script.onload = onload;
		}
		document.body.appendChild(script);
	}

	performance.mark('code/willLoadWorkbenchMain');

	// English messages must be defined before the workbench module evaluates.
	loadModule('out/nls.messages.js', function () {
		loadModule('out/vs/code/browser/workbench/workbench.js');
	});
})();
