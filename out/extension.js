"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs_1 = __importDefault(require("fs"));
const debugManimViewer = false;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    // console.log('Congratulations, your extension "manim-viewer" is now active!');
    // Open extension settings
    context.subscriptions.push(vscode.commands.registerCommand('manimViewer.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:marcel-goldschen-ohm.manim-viewer');
    }));
    // Show viewer webview panel
    context.subscriptions.push(vscode.commands.registerCommand('manimViewer.showViewer', () => {
        ManimViewerPanel.createOrShow(context.extensionUri);
    }));
    // if (vscode.window.registerWebviewPanelSerializer) {
    // 	// Make sure we register a serializer in activation event
    // 	vscode.window.registerWebviewPanelSerializer(ManimViewerPanel.viewType, {
    // 		async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: unknown) {
    // 			console.log(`Got state: ${state}`);
    // 			// Reset the webview options so we use latest uri for `localResourceRoots`.
    // 			webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
    // 			ManimViewerPanel.revive(webviewPanel, context.extensionUri);
    // 		}
    // 	});
    // }
}
// This method is called when your extension is deactivated
function deactivate() {
    if (ManimViewerPanel.currentPanel) {
        ManimViewerPanel.currentPanel.closeMainTerminal();
        ManimViewerPanel.currentPanel.dispose();
    }
}
class ManimViewerPanel {
    static currentPanel;
    static viewType = 'manimViewerPanel';
    _panel;
    _extensionUri;
    _disposables = [];
    // selected scene and associated video
    _codeEditor;
    _codeDocument;
    _scenes = [];
    _selectedScene;
    _videoUri;
    _videoStatus;
    _videoStatusIconUri;
    _autoSelectScene = true;
    _mainTerminal;
    _mainRenderProcess;
    _backgroundRenderProcesses = {};
    // for debouncing async events
    _documentChangeTimeout;
    _selectionChangeTimeout;
    refresh() {
        const editor = this._codeEditor;
        const document = this._codeDocument;
        const scene = this._selectedScene;
        // wait a tiny bit so that editor.selection.active is updated
        setTimeout(() => this.setCodeDocument(document, editor, scene), 100);
    }
    setCodeDocument(document, editor, scene) {
        const isFile = document?.uri.scheme === 'file';
        const isPython = document?.languageId === 'python';
        if (!isFile || !isPython || !isExistingFile(document?.uri.fsPath)) {
            return;
        }
        this._codeEditor = editor;
        this._codeDocument = document;
        this._scenes = parsePythonCodeForManimOutline(this._codeDocument.getText());
        scene = this._getScene(scene);
        if (debugManimViewer) {
            console.log('setCodeDocument: scene=', scene?.name);
        }
        if (scene === undefined) {
            if (this._autoSelectScene) {
                scene = this._getSceneUnderCursor();
            }
            else {
                scene = this._selectedScene;
                if (scene === undefined) {
                    scene = this._getSceneUnderCursor();
                }
            }
            if (debugManimViewer) {
                console.log('try again: scene=', scene?.name);
            }
        }
        this.setScene(scene);
    }
    setScene(scene) {
        this._selectedScene = this._getScene(scene);
        if (debugManimViewer) {
            console.log('setScene: scene=', this._selectedScene?.name);
        }
        this.updateVideo();
    }
    updateVideo() {
        this._videoUri = getVideoUri(this._codeDocument?.uri, this._selectedScene?.name);
        if (debugManimViewer) {
            console.log('updateVideo: path=', this._videoUri?.fsPath);
        }
        this.updateVideoStatus();
    }
    updateVideoStatus() {
        this._videoStatus = this._getVideoStatus();
        if (debugManimViewer) {
            console.log('updateVideoStatus: status=', this._videoStatus);
        }
        switch (this._videoStatus) {
            case 'Video up-to-date with code':
                this._videoStatusIconUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'dark', 'pass.svg');
                break;
            case 'Video out-of-date with code':
            case 'Video match with code unknown':
                this._videoStatusIconUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'dark', 'warning.svg');
                break;
            case 'Video does not exist':
                this._videoStatusIconUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'dark', 'error.svg');
                break;
            default:
                this._videoStatusIconUri = undefined;
                break;
        }
        this._updatePanel();
    }
    renderScene(scene, forceRender = false, renderInBackground = false) {
        if (this._codeDocument === undefined) {
            return;
        }
        scene = this._getScene(scene);
        if (scene === undefined) {
            return;
        }
        if (this._videoUri === undefined) {
            this._videoUri = getVideoUri(this._codeDocument.uri, scene.name);
            if (this._videoUri === undefined) {
                return;
            }
        }
        if (debugManimViewer) {
            console.log('renderScene: scene=', scene.name, 'forceRender=', forceRender, 'renderInBackground=', renderInBackground);
        }
        if (!forceRender) {
            var videoCodeCache = readVideoCodeCache(this._videoUri);
            if (scene.name in videoCodeCache) {
                if (videoCodeCache[scene.name] === scene.code) {
                    if (debugManimViewer) {
                        console.log('Video already up-to-date, don\'t render');
                    }
                    return;
                }
            }
        }
        // render scene in terminal
        var renderProcess = {
            terminal: undefined,
            codeUri: this._codeDocument.uri,
            scene: scene,
            quality: getQualitySetting(),
            videoUri: this._videoUri,
        };
        if (renderInBackground) {
            const videoFilePath = this._videoUri.fsPath;
            if (videoFilePath in this._backgroundRenderProcesses) {
                // this video is already being rendered
                return;
            }
            // render in a background terminal
            renderProcess.terminal = vscode.window.createTerminal(scene.name);
            this._backgroundRenderProcesses[videoFilePath] = renderProcess;
        }
        else {
            if (this._mainRenderProcess !== undefined) {
                // only one main render process at a time
                return;
            }
            // render in the main terminal and show it without stealing focus
            renderProcess.terminal = this.getMainTerminal();
            renderProcess.terminal.show(true);
            this._mainRenderProcess = renderProcess;
        }
        const codeFilePath = this._codeDocument.uri.fsPath;
        const codeDir = path.dirname(codeFilePath);
        const codeFileName = path.basename(codeFilePath);
        const qualityFlag = getQualityFlag(renderProcess.quality) ?? 'l';
        // TODO: use videoUri. For now, manim's default output path should be the same as the videoUri.
        renderProcess.terminal.sendText(`cd ${codeDir}; manim --quality=${qualityFlag} ${codeFileName} ${scene.name}`);
        if (debugManimViewer) {
            console.log('Render command sent to terminal');
        }
    }
    isActive() {
        return this._panel.active;
    }
    getMainTerminal() {
        if (this._mainTerminal) {
            return this._mainTerminal;
        }
        // Create the terminal
        this._mainTerminal = vscode.window.createTerminal('Manim Viewer');
        // Dispose if the terminal is closed
        vscode.window.onDidCloseTerminal(async (event) => {
            if (event.name === 'Manim Viewer') {
                this._mainTerminal = undefined;
            }
        });
        return this._mainTerminal;
    }
    closeMainTerminal() {
        if (this._mainTerminal) {
            this._mainTerminal.dispose();
            this._mainTerminal = undefined;
        }
    }
    static createOrShow(extensionUri) {
        // If we already have a panel, show it.
        if (ManimViewerPanel.currentPanel) {
            ManimViewerPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(ManimViewerPanel.viewType, 'Manim Viewer', vscode.ViewColumn.Beside, getWebviewOptions(extensionUri));
        ManimViewerPanel.currentPanel = new ManimViewerPanel(panel, extensionUri);
    }
    static revive(panel, extensionUri) {
        ManimViewerPanel.currentPanel = new ManimViewerPanel(panel, extensionUri);
    }
    constructor(panel, extensionUri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        // Set the webview html
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        // Handle vscode events
        vscode.window.onDidChangeActiveTextEditor((editor) => this._onActiveTextEditorChanged(editor));
        vscode.workspace.onDidChangeTextDocument((event) => this._onTextDocumentChanged(event));
        vscode.window.onDidChangeTextEditorSelection((event) => this._onTextEditorSelectionChanged(event));
        vscode.workspace.onDidSaveTextDocument((document) => this._onTextDocumentSaved(document));
        // vscode.workspace.onDidDeleteFiles((event) => this._onFileDeleted(event));
        // vscode.workspace.onDidRenameFiles((event) => this._onFileRenamed(event));
        vscode.window.onDidEndTerminalShellExecution(async (event) => this._onTerminalShellExecutionEnded(event));
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'selectScene':
                    this.setScene(message.scene);
                    return;
                case 'renderScene':
                    this.renderScene(message.scene, message.forceRender, message.renderInBackground);
                    return;
                case 'autoSelectScene':
                    this._autoSelectScene = message.value;
                    if (debugManimViewer) {
                        console.log('autoSelectScene=', this._autoSelectScene);
                    }
                    if (this._autoSelectScene) {
                        setTimeout(() => {
                            const scene = this._getSceneUnderCursor();
                            if (scene && scene !== this._selectedScene) {
                                this.setScene(scene);
                            }
                        }, 50);
                    }
                    return;
                case 'openSettings':
                    vscode.commands.executeCommand('manimViewer.openSettings');
                    return;
            }
        }, null, this._disposables);
        // init webview for the active text editor
        this._onActiveTextEditorChanged(vscode.window.activeTextEditor);
    }
    dispose() {
        ManimViewerPanel.currentPanel = undefined;
        // Clean up our resources
        this._panel.dispose();
        if (this._mainTerminal) {
            this._mainTerminal.dispose();
        }
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    _updatePanel() {
        if (debugManimViewer) {
            console.log('_updatePanel');
        }
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }
    _getHtmlForWebview(webview) {
        // file paths
        const scriptUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');
        const styleResetUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
        const styleMainUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css');
        const styleManimViewerUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'manimViewer.css');
        const refreshSvgUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'dark', 'refresh.svg');
        const gearSvgUri = vscode.Uri.joinPath(this._extensionUri, 'resources', 'dark', 'gear.svg');
        const codeUri = this._codeDocument?.uri;
        // as webview paths
        const scriptWebviewUri = webview.asWebviewUri(scriptUri);
        const styleResetWebviewUri = webview.asWebviewUri(styleResetUri);
        const styleMainWebviewUri = webview.asWebviewUri(styleMainUri);
        const styleManimViewerWebviewUri = webview.asWebviewUri(styleManimViewerUri);
        const refreshSvgWebviewUri = webview.asWebviewUri(refreshSvgUri);
        const gearSvgWebviewUri = webview.asWebviewUri(gearSvgUri);
        const videoWebviewUri = this._videoUri ? webview.asWebviewUri(this._videoUri) : undefined;
        const videoStatusIconWebviewUri = this._videoStatusIconUri ? webview.asWebviewUri(this._videoStatusIconUri) : undefined;
        // file paths relative to workspace
        const workspaceFolder = codeUri ? vscode.workspace.getWorkspaceFolder(codeUri) : undefined;
        const codeRelFilePath = workspaceFolder && codeUri ? path.relative(workspaceFolder.uri.fsPath, codeUri.fsPath) : codeUri?.fsPath;
        const videoRelFilePath = workspaceFolder && this._videoUri ? path.relative(workspaceFolder.uri.fsPath, this._videoUri.fsPath) : this._videoUri?.fsPath;
        // scene select html
        var sceneOptions = '<option value="">-- Select Scene --</option>';
        for (const scene of this._scenes) {
            sceneOptions += `<option value="${scene.name}" ${this._selectedScene?.name === scene.name ? 'selected' : ''}>${scene.name}</option>`;
        }
        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();
        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; media-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetWebviewUri}" rel="stylesheet">
				<link href="${styleMainWebviewUri}" rel="stylesheet">
				<link href="${styleManimViewerWebviewUri}" rel="stylesheet">

				<title>Manim Viewer</title>
			</head>
			<body>
				<div id="video-filepath">
					${videoRelFilePath ?? ''}
				</div>

				<video id="video-player" autoplay loop muted playsinline>
					<source src="${videoWebviewUri ?? ''}" type="video/mp4">
				</video>

				<div id="video-status-wrapper">
					<img id="video-status-icon" src="${videoStatusIconWebviewUri ?? ''}" />
					<div id="video-status-text">
						${this._videoStatus ?? ''}
					</div>
				</div>

				<div id="code-filepath">
					${codeRelFilePath ?? ''}
				</div>

				<div id="selected-scene-controls">
					<select id="scene-select">
						${sceneOptions}
					</select>

					<button id="render-button">
						<img src="${refreshSvgWebviewUri ?? ''}" /> Render
					</button>

					<div id="auto-select-scene-wrapper">
						<input type="checkbox" id="auto-select-scene-checkbox" ${this._autoSelectScene ? "checked" : ""} />
						<div id="auto-select-scene-text">
							Auto-Select Scene<br />Under Cursor
						</div>
					</div>

					<button id="settings-button">
						<img src="${gearSvgWebviewUri ?? ''}" />
					</button>
				</div>

				<script nonce="${nonce}" src="${scriptWebviewUri}"></script>
			</body>
			</html>`;
    }
    _onActiveTextEditorChanged(editor) {
        if (debugManimViewer) {
            console.log('_onActiveTextEditorChanged');
        }
        const document = editor?.document;
        // wait a tiny bit so that editor.selection.active is updated
        setTimeout(() => this.setCodeDocument(document, editor), 50);
    }
    _onTextDocumentChanged(event) {
        if (event.document !== this._codeDocument) {
            return;
        }
        // Debounce the selection change event
        // to avoid repeated calls during dragging selections or rapid typing.
        clearTimeout(this._documentChangeTimeout);
        this._documentChangeTimeout = setTimeout(() => this._handleTextDocumentChange(event), 100);
    }
    _handleTextDocumentChange(event) {
        if (debugManimViewer) {
            console.log('_handleTextDocumentChange');
        }
        this.setCodeDocument(event.document, this._codeEditor);
        this._documentChangeTimeout = undefined;
    }
    _onTextEditorSelectionChanged(event) {
        if (event.textEditor.document !== this._codeDocument) {
            return;
        }
        if (!this._autoSelectScene) {
            // we only care about this event if we are auto-selecting scenes under the cursor
            return;
        }
        if (this._documentChangeTimeout) {
            // don't handle selection change if a document change is pending
            return;
        }
        // Debounce the selection change event
        // to avoid repeated calls during dragging selections or rapid typing.
        // The short wait also ensures that editor.selection.active is updated.
        clearTimeout(this._selectionChangeTimeout);
        this._selectionChangeTimeout = setTimeout(() => this._handleTextEditorSelectionChange(event), 150);
    }
    _handleTextEditorSelectionChange(event) {
        if (debugManimViewer) {
            console.log('_handleTextEditorSelectionChange');
        }
        const selection = event.selections[0];
        const cursorPosition = selection?.active;
        if (cursorPosition) {
            const scene = this._getSceneAtLine(cursorPosition.line);
            if (scene && scene !== this._selectedScene) {
                this.setScene(scene.name);
            }
        }
        this._selectionChangeTimeout = undefined;
    }
    _onTextDocumentSaved(document) {
        if (document !== this._codeDocument) {
            return;
        }
        // wait a tiny bit so that editor.selection.active is updated
        setTimeout(() => this._handleTextDocumentSave(document), 200);
    }
    _handleTextDocumentSave(document) {
        if (debugManimViewer) {
            console.log('_handleTextDocumentSave');
        }
        this.setCodeDocument(this._codeDocument, this._codeEditor, this._selectedScene);
        if (getRenderOnSaveSetting()) {
            const scene = this._selectedScene;
            const forceRender = false;
            const renderInBackground = false;
            this.renderScene(scene, forceRender, renderInBackground);
        }
    }
    _onTerminalShellExecutionEnded(event) {
        if (debugManimViewer) {
            console.log('_onTerminalShellExecutionEnded: terminal=', event.terminal.name);
        }
        if (event.terminal === this._mainRenderProcess?.terminal) {
            const renderProcess = this._mainRenderProcess;
            if (debugManimViewer) {
                console.log('Main render process ended');
            }
            updateVideoCodeCache(renderProcess.videoUri, renderProcess.scene.name, renderProcess.scene.code);
            cleanUpPartialMovieFiles(renderProcess.videoUri, renderProcess.scene.name);
            this.refresh();
            this._mainRenderProcess = undefined;
        }
        else {
            for (const videoFilePath in this._backgroundRenderProcesses) {
                const renderProcess = this._backgroundRenderProcesses[videoFilePath];
                if (event.terminal === renderProcess.terminal) {
                    if (debugManimViewer) {
                        console.log('Background render process ended');
                    }
                    updateVideoCodeCache(renderProcess.videoUri, renderProcess.scene.name, renderProcess.scene.code);
                    cleanUpPartialMovieFiles(renderProcess.videoUri, renderProcess.scene.name);
                    this._backgroundRenderProcesses[videoFilePath].terminal?.dispose();
                    delete this._backgroundRenderProcesses[videoFilePath];
                    break;
                }
            }
        }
    }
    _getScene(scene) {
        if (typeof scene === 'string') {
            return this._scenes.find(s => s.name === scene);
        }
        return scene;
    }
    _getSceneUnderCursor() {
        const cursorPosition = this._codeEditor?.selection?.active;
        if (cursorPosition === undefined) {
            return undefined;
        }
        return this._getSceneAtLine(cursorPosition?.line);
    }
    _getSceneAtLine(lineIndex) {
        for (const scene of this._scenes) {
            if (lineIndex >= scene.lineStart && lineIndex < scene.lineEnd) {
                return scene;
            }
        }
        return undefined;
    }
    _getVideoStatus() {
        if ((this._selectedScene === undefined) || (this._videoUri === undefined)) {
            return undefined;
        }
        if (!isExistingFile(this._videoUri?.fsPath)) {
            return 'Video does not exist';
        }
        const videoCodeCache = readVideoCodeCache(this._videoUri);
        if (this._selectedScene.name in videoCodeCache) {
            const cachedLines = videoCodeCache[this._selectedScene.name].split('\n');
            const sceneLines = this._selectedScene.code.split('\n');
            if (debugManimViewer) {
                console.log('--- Cached code:');
                console.log(cachedLines);
                console.log('--- Scene code:');
                console.log(sceneLines);
            }
            if (videoCodeCache[this._selectedScene.name] === this._selectedScene.code) {
                return 'Video up-to-date with code';
            }
            else {
                return 'Video out-of-date with code';
            }
        }
        return 'Video match with code unknown';
    }
}
function getWebviewOptions(extensionUri) {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        // And restrict the webview to only loading content from our extension's `media` directory.
        // localResourceRoots: [extensionUri] //[vscode.Uri.joinPath(extensionUri, 'media')]
    };
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function isExistingFileOrDirectory(path) {
    if (path === undefined) {
        return false;
    }
    try {
        fs_1.default.accessSync(path);
        return true;
    }
    catch (err) {
        return false;
    }
}
function isExistingFile(path) {
    if (path === undefined) {
        return false;
    }
    try {
        return fs_1.default.statSync(path).isFile();
    }
    catch (err) {
        return false;
    }
}
function isExistingDirectory(path) {
    if (path === undefined) {
        return false;
    }
    try {
        return fs_1.default.statSync(path).isDirectory();
    }
    catch (err) {
        return false;
    }
}
function parsePythonCodeForManimOutline(pythonCode) {
    var scenes = [];
    var scene;
    var isManim = false;
    let lines = pythonCode.split('\n');
    for (var i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isManim === false) {
            if (line.startsWith('from manim import ')) {
                isManim = true;
                continue;
            }
        }
        if (line.startsWith('class ') || line.startsWith('def ')) {
            const lastScene = scenes.length > 0 ? scenes[scenes.length - 1] : undefined;
            if (lastScene && (lastScene.lineEnd === lastScene.lineStart)) {
                scenes[scenes.length - 1].lineEnd = i;
                scenes[scenes.length - 1].code = compressPythonCode(lines.slice(lastScene.lineStart, i));
            }
        }
        if (line.startsWith('class ')) {
            scene = {
                name: line.substring(6).split('(')[0].trim(),
                lineStart: i,
                lineEnd: i,
                code: '',
            };
        }
        else if (line.trim() === 'def construct(self):') {
            if (scene && !scenes.includes(scene)) {
                scenes.push(scene);
            }
        }
    }
    const lastScene = scenes.length > 0 ? scenes[scenes.length - 1] : undefined;
    if (lastScene && (lastScene.lineEnd === lastScene.lineStart)) {
        scenes[scenes.length - 1].lineEnd = lines.length;
        scenes[scenes.length - 1].code = compressPythonCode(lines.slice(lastScene.lineStart, lines.length));
    }
    // console.log(scenes);
    if (!isManim) {
        scenes = [];
    }
    return scenes;
}
function compressPythonCode(lines) {
    var compressedLines = [];
    for (var line of lines) {
        const pos = line.indexOf('#');
        if (pos !== -1) {
            line = line.substring(0, pos);
        }
        line = line.trimEnd();
        if (line.trim() !== '') {
            compressedLines.push(line);
        }
    }
    return compressedLines.join('\n');
}
function getQualitySetting() {
    const settings = vscode.workspace.getConfiguration('manimViewer');
    const value = settings?.get('renderQuality');
    return value ?? '480p15';
}
function getQualityFlag(quality) {
    if (quality === undefined) {
        quality = getQualitySetting();
    }
    switch (quality) {
        case '480p15':
            return 'l';
        case '720p30':
            return 'm';
        case '1080p60':
            return 'h';
        case '1440p60':
            return 'p';
        case '2160p60':
            return 'k';
        default:
            return undefined;
    }
}
function getRenderOnSaveSetting() {
    const settings = vscode.workspace.getConfiguration('manimViewer');
    const value = settings?.get('renderOnSave');
    return value ?? true;
}
function getVideoUri(codeUri, scene) {
    if (codeUri === undefined || scene === undefined) {
        return undefined;
    }
    const codeFilePath = codeUri.fsPath;
    const codeFileDir = path.dirname(codeFilePath);
    const codeFileName = path.basename(codeFilePath, '.py');
    const quality = getQualitySetting();
    const videoFileDir = path.join(codeFileDir, 'media', 'videos', codeFileName, quality);
    const videoFileName = scene + '.mp4';
    const videoFilePath = path.join(videoFileDir, videoFileName);
    return vscode.Uri.file(videoFilePath);
}
function getVideoCodeCacheUri(videoUri) {
    if (videoUri === undefined) {
        return undefined;
    }
    const videoDir = path.dirname(videoUri.fsPath);
    const videoCodeFilePath = path.join(videoDir, 'manimViewer.json');
    return vscode.Uri.file(videoCodeFilePath);
}
function readVideoCodeCache(videoUri) {
    var videoCodeCache = {};
    const videoCodeCacheUri = getVideoCodeCacheUri(videoUri);
    if (isExistingFile(videoCodeCacheUri?.fsPath)) {
        videoCodeCache = JSON.parse(fs_1.default.readFileSync(videoCodeCacheUri.fsPath, 'utf8'));
    }
    return videoCodeCache;
}
function writeVideoCodeCache(videoUri, videoCodeCache) {
    if (videoUri) {
        const videoCodeCacheUri = getVideoCodeCacheUri(videoUri);
        if (videoCodeCacheUri) {
            fs_1.default.writeFileSync(videoCodeCacheUri.fsPath, JSON.stringify(videoCodeCache, null, 4));
        }
    }
}
function updateVideoCodeCache(videoUri, sceneName, code) {
    if (videoUri === undefined || sceneName === undefined || code === undefined) {
        return;
    }
    var videoCodeCache = readVideoCodeCache(videoUri);
    videoCodeCache[sceneName] = code;
    writeVideoCodeCache(videoUri, videoCodeCache);
}
function cleanUpPartialMovieFiles(videoUri, sceneName) {
    const videoDir = path.dirname(videoUri.fsPath);
    const partialMovieFilesDir = path.join(videoDir, 'partial_movie_files');
    if (!isExistingDirectory(partialMovieFilesDir)) {
        return;
    }
    const sceneDirNames = fs_1.default.readdirSync(partialMovieFilesDir);
    // console.log(sceneDirNames);
    for (const sceneDirName of sceneDirNames) {
        const sceneDir = path.join(partialMovieFilesDir, sceneDirName);
        const stat = fs_1.default.statSync(sceneDir);
        if (stat.isDirectory()) {
            if (sceneName === undefined || sceneDirName === sceneName) {
                var partialMovieFiles = [];
                var listedPartialMovieFiles = [];
                const sceneFileNames = fs_1.default.readdirSync(sceneDir);
                // console.log(sceneFileNames);
                for (const sceneFileName of sceneFileNames) {
                    const sceneFilePath = path.join(sceneDir, sceneFileName);
                    if (isExistingFile(sceneFilePath)) {
                        if (sceneFileName.endsWith('.mp4')) {
                            partialMovieFiles.push(sceneFilePath);
                        }
                        else if (sceneFileName === 'partial_movie_file_list.txt') {
                            const data = fs_1.default.readFileSync(sceneFilePath, 'utf8');
                            const lines = data.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('file ')) {
                                    // file 'path/to/file.mp4'
                                    const listedSceneFilePath = line.substring(6, line.length - 1).trim();
                                    listedPartialMovieFiles.push(listedSceneFilePath);
                                }
                            }
                        }
                    }
                }
                // console.log(partialMovieFiles);
                // console.log(listedPartialMovieFiles);
                // delete partial movie files that are not listed in partial_movie_file_list.txt
                for (const partialMovieFile of partialMovieFiles) {
                    if (!listedPartialMovieFiles.includes(partialMovieFile)) {
                        fs_1.default.unlinkSync(partialMovieFile);
                    }
                }
            }
            if (sceneDirName === sceneName) {
                break;
            }
        }
    }
}
// class ManimOutlineProvider implements vscode.TreeDataProvider<ManimOutlineTreeItem> {
// 	public static readonly viewType = 'manimOutline';
// 	private _onDidChangeTreeData: vscode.EventEmitter<ManimOutlineTreeItem | undefined | void> = new vscode.EventEmitter<ManimOutlineTreeItem | undefined | void>();
// 	readonly onDidChangeTreeData: vscode.Event<ManimOutlineTreeItem | undefined | void> = this._onDidChangeTreeData.event;
// 	private _codeEditor: vscode.TextEditor | undefined;
// 	private _codeDocument: vscode.TextDocument | undefined;
// 	private _sceneName: string | undefined;
// 	private _videoUri: vscode.Uri | undefined;
// 	private _sceneTreeItems: ManimOutlineTreeItem[] = [];
// 	private _sceneIconPath: any = {
// 		light: path.join(__filename, '..', '..', 'resources', 'light', 'symbol-interface.svg'),
// 		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'symbol-interface.svg')
// 	};
// 	// for debouncing async events
// 	private _isHandlingDocumentSave: boolean = false;
// 	private _isHandlingDocumentChange: boolean = false;
// 	private _isHandlingSelectionChange: boolean = false;
// 	private _documentSaveTimeout: NodeJS.Timeout | string | number | undefined;
// 	private _documentChangeTimeout: NodeJS.Timeout | string | number | undefined;
// 	private _selectionChangeTimeout: NodeJS.Timeout | string | number | undefined;
// 	constructor(private context: vscode.ExtensionContext) {
// 		vscode.window.onDidChangeActiveTextEditor(() => this._onActiveTextEditorChanged());
// 		vscode.workspace.onDidSaveTextDocument((document) => this._onTextDocumentSaved(document));
// 		vscode.workspace.onDidChangeTextDocument(event => this._onTextDocumentChanged(event));
// 		vscode.window.onDidChangeTextEditorSelection((event) => this._onTextEditorSelectionChanged(event));
// 		vscode.workspace.onDidDeleteFiles((event) => this._onFileDeleted(event));
// 		vscode.workspace.onDidRenameFiles((event) => this._onFileRenamed(event));
// 		// this.onDidChangeTreeData(() => this._onTreeDataChanged());
// 		this._onActiveTextEditorChanged();
// 	}
// 	private _getTreeView(): vscode.TreeView<ManimOutlineTreeItem> {
// 		return vscode.window.createTreeView(ManimOutlineProvider.viewType, { treeDataProvider: this });
// 	}
// 	refresh() {
// 		// console.log('refresh');
// 		this.setCodeDocument(this._codeDocument);
// 	}
// 	collapseAll() {
// 		vscode.commands.executeCommand('workbench.actions.treeView.' + ManimOutlineProvider.viewType + '.collapseAll');
// 	}
// 	onTreeItemSelected(item: ManimOutlineTreeItem) {
// 		this._setCursorPositionToScene(item);
// 		this.setScene(item);
// 	}
// 	setCodeDocument(document: vscode.TextDocument | undefined) {
// 		// console.log('set code document');
// 		this._codeDocument = document;
// 		// reset outline tree
// 		const contents = this._codeDocument?.getText();
// 		this._sceneTreeItems = contents ? this._parsePythonCodeForManimOutline(contents) : [];
// 		let sceneTreeItem = this._getSceneTreeItemFromCursorPosition();
// 		if (sceneTreeItem) {
// 			this.setScene(sceneTreeItem);
// 		} else {
// 			// TODO: set scene based on stored state
// 			// if not set based on stored state, clear the scene
// 			this.setScene(undefined);
// 		}
// 		// update outline view title
// 		this._updateTreeViewTitle();
// 		// needed?
// 		this._onDidChangeTreeData.fire();
// 	}
// 	setScene(scene: ManimOutlineTreeItem | string | undefined, forceRender: boolean = false) {
// 		// console.log('set scene');
// 		var sceneTreeItem: ManimOutlineTreeItem | undefined;
// 		if (scene instanceof ManimOutlineTreeItem) {
// 			sceneTreeItem = scene;
// 			this._sceneName = sceneTreeItem.label?.toString();
// 		} else {
// 			this._sceneName = this._isValidSceneName(scene) ? scene : undefined;
// 			sceneTreeItem = this._getSceneTreeItemFromName(this._sceneName);
// 		}
// 		// update tree selection
// 		if (sceneTreeItem) {
// 			this._getTreeView().reveal(sceneTreeItem, {select: true});
// 		}
// 		this._videoUri = this._getVideoUri();
// 		if (ManimViewerPanel.currentPanel === undefined) {
// 			return;
// 		}
// 		ManimViewerPanel.currentPanel.refresh(this._videoUri);
// 		if (this._videoUri === undefined) {
// 			return;
// 		}
// 		if (forceRender || !this._isExistingFile(this._videoUri?.fsPath)) {
// 			this.renderScene();
// 			return;
// 		}
// 		if (!this._isHandlingDocumentSave && (this._isHandlingDocumentChange || this._isHandlingSelectionChange)) {
// 			return;
// 		}
// 		// check cached code to see if there is anything new to render
// 		if (this._sceneName && sceneTreeItem) {
// 			const videoCodeUri = this._getVideoCodeUri(this._videoUri);
// 			if (videoCodeUri && this._isExistingFile(videoCodeUri.fsPath)) {
// 				try {
// 					const sceneCode = JSON.parse(fs.readFileSync(videoCodeUri.fsPath, 'utf8'));
// 					const cachedSceneCode = sceneCode[this._sceneName];
// 					const currentSceneCode = sceneTreeItem.code;
// 					// console.log('Cached:\n' + cachedSceneCode);
// 					// console.log('Current:\n' + currentSceneCode);
// 					if (cachedSceneCode === currentSceneCode) {
// 						// console.log('Scene code is already up to date');
// 						return;
// 					}
// 				} catch (err) {
// 				}
// 			}
// 		}
// 		this.renderScene();
// 	}
// 	renderScene(sceneName?: string) {
// 		if (ManimViewerPanel.currentPanel) {
// 			const codeFilePath = this._codeDocument?.uri.fsPath;
// 			if (sceneName === undefined) {
// 				sceneName = this._sceneName;
// 			}
// 			if (codeFilePath && sceneName) {
// 				// console.log('rendering scene');
// 				const codeFileDir = path.dirname(codeFilePath);
// 				const codeFileName = path.basename(codeFilePath);
// 				const quality = this._getQuality();
// 				const qualityFlags: { [key: string]: string } = {
// 					"480p15": "l",
// 					"720p30": "m",
// 					"1080p60": "h",
// 					"1440p60": "p",
// 					"2160p60": "k"
// 				};
// 				const qualityFlag = qualityFlags[quality];
// 				var videoFilePath = this._videoUri?.fsPath;
// 				if (videoFilePath === undefined) {
// 					const codeFileNameNoExt = path.basename(codeFilePath, '.py');
// 					videoFilePath = path.join(codeFileDir, 'media', 'videos', codeFileNameNoExt, quality, sceneName + '.mp4');
// 				}
// 				const terminal: vscode.Terminal = ManimViewerPanel.currentPanel.getMainTerminal();
// 				// TODO: use videoUri
// 				// For now, manim's default output path should be the same as the videoUri.
// 				terminal.sendText(`cd ${codeFileDir}; manim --quality=${qualityFlag} ${codeFileName} ${sceneName}`);
// 				// store scene code for rendered video
// 				const videoDir = path.dirname(videoFilePath);
// 				const sceneCodeFilePath = path.join(videoDir, 'manimViewer.json');
// 				var sceneCode: {[key: string]: any} = {}; // stupid typescript
// 				if (this._isExistingFile(sceneCodeFilePath)) {
// 					sceneCode = JSON.parse(fs.readFileSync(sceneCodeFilePath, 'utf8'));
// 				}
// 				// console.log(sceneCode);
// 				const sceneTreeItem = this._sceneTreeItems.find(item => item.label === sceneName);
// 				if (sceneTreeItem) {
// 					sceneCode[sceneName] = sceneTreeItem.code;
// 					fs.writeFileSync(sceneCodeFilePath, JSON.stringify(sceneCode, null, 4));
// 				}
// 				// clean up partial movie files
// 				this._cleanUpPartialMovieFiles(videoDir, sceneName);
// 			}
// 		}
// 	}
// 	getCurrentSceneName(): string | undefined {
// 		return this._sceneName;
// 	}
// 	private _getVideoUri(): vscode.Uri | undefined {
// 		if (this._codeDocument === undefined || this._sceneName === undefined) {
// 			return undefined;
// 		}
// 		const codeFilePath = this._codeDocument.uri.fsPath;
// 		const codeFileDir = path.dirname(codeFilePath);
// 		const codeFileName = path.basename(codeFilePath, '.py');
// 		const quality = this._getQuality();
// 		const videoFileDir = path.join(codeFileDir, 'media', 'videos', codeFileName, quality);
// 		const videoFileName = this._sceneName + '.mp4';
// 		const videoFilePath = path.join(videoFileDir, videoFileName);
// 		return vscode.Uri.file(videoFilePath);
// 	}
// 	private _getVideoCodeUri(videoUri: vscode.Uri | undefined): vscode.Uri | undefined {
// 		if (videoUri === undefined) {
// 			return undefined;
// 		}
// 		const videoDir = path.dirname(videoUri.fsPath);
// 		const videoCodeFilePath = path.join(videoDir, 'manimViewer.json');
// 		return vscode.Uri.file(videoCodeFilePath);
// 	}
// 	private _cleanUpPartialMovieFiles(videoDir: string, sceneName: string | undefined) {
// 		// console.log('clean up partial movie files');
// 		let partialMovieFilesDir = path.join(videoDir, 'partial_movie_files');
// 		// console.log(partialMovieFilesDir);
// 		if (!this._isExistingDirectory(partialMovieFilesDir)) {
// 			return;
// 		}
// 		const sceneDirNames = fs.readdirSync(partialMovieFilesDir);
// 		// console.log(sceneDirNames);
// 		for (const sceneDirName of sceneDirNames) {
// 		  const sceneDir = path.join(partialMovieFilesDir, sceneDirName);
// 		  const stat = fs.statSync(sceneDir);
// 		  if (stat.isDirectory()) {
// 			if (sceneName === undefined || sceneDirName === sceneName) {
// 				var partialMovieFiles: string[] = [];
// 				var listedPartialMovieFiles: string[] = [];
// 				const sceneFileNames = fs.readdirSync(sceneDir);
// 				// console.log(sceneFileNames);
// 				for (const sceneFileName of sceneFileNames) {
// 				  const sceneFilePath = path.join(sceneDir, sceneFileName);
// 				  const stat = fs.statSync(sceneFilePath);
// 				  if (stat.isFile()) {
// 					if (sceneFileName.endsWith('.mp4')) {
// 					  partialMovieFiles.push(sceneFilePath);
// 					} else if (sceneFileName === 'partial_movie_file_list.txt') {
// 					  const data = fs.readFileSync(sceneFilePath, 'utf8');
// 					  const lines = data.split('\n');
// 					  for (const line of lines) {
// 						if (line.startsWith('file ')) {
// 							// file 'path/to/file.mp4'
// 							const listedSceneFilePath = line.substring(6, line.length - 1).trim();
// 							listedPartialMovieFiles.push(listedSceneFilePath);
// 						}
// 					  }
// 					}
// 				  }
// 				}
// 				// console.log(partialMovieFiles);
// 				// console.log(listedPartialMovieFiles);
// 				// delete partial movie files that are not listed in partial_movie_file_list.txt
// 				for (const partialMovieFile of partialMovieFiles) {
// 				  if (!listedPartialMovieFiles.includes(partialMovieFile)) {
// 					fs.unlinkSync(partialMovieFile);
// 				  }
// 				}
// 			}
// 			if (sceneDirName === sceneName) {
// 				break;
// 			}
// 		  }
// 		}
// 	}
// 	private _isExistingFile(path: fs.PathLike | undefined): boolean {
// 		if (path === undefined) {
// 			return false;
// 		}
// 		try {
// 			fs.accessSync(path);
// 			return true;
// 		} catch (err) {
// 			return false;
// 		}
// 	}
// 	private _isExistingDirectory(path: fs.PathLike | undefined): boolean {
// 		if (path === undefined) {
// 			return false;
// 		}
// 		try {
// 		  return fs.statSync(path).isDirectory();
// 		} catch (err) {
// 		  return false;
// 		}
// 	  }
// 	private _isValidCodeDocument(document: vscode.TextDocument): boolean {
// 		const isFile = document.uri.scheme === 'file';
// 		const isPython = document.languageId === 'python';
// 		if (!isFile || !isPython) {
// 			return false;
// 		}
// 		return this._isExistingFile(document.uri.fsPath);
// 	}
// 	private _isValidSceneName(sceneName: string | undefined): boolean {
// 		if (sceneName === undefined) {
// 			return false;
// 		}
// 		return this._sceneTreeItems.some(item => item.label === sceneName);
// 	}
// 	private _getSceneTreeItemFromName(sceneName: string | undefined): ManimOutlineTreeItem | undefined {
// 		if (sceneName === undefined) {
// 			return undefined;
// 		}
// 		return this._sceneTreeItems.find(item => item.label === sceneName);
// 	}
// 	private _setCursorPositionToScene(scene: ManimOutlineTreeItem | string | undefined) {
// 		if (scene instanceof ManimOutlineTreeItem) {
// 			if (this._codeEditor) {
// 				const position = this._codeEditor.selection.active;
// 				var newPosition = position.with(scene.startLine, 0);
// 				var newSelection = new vscode.Selection(newPosition, newPosition);
// 				this._codeEditor.selection = newSelection;
// 			}
// 		} else if (typeof scene === "string") {
// 			const sceneItem = this._sceneTreeItems.find(item => item.label === scene);
// 			if (sceneItem) {
// 				this._setCursorPositionToScene(sceneItem);
// 			}
// 		}
// 	}
// 	private _getSceneTreeItemFromCursorPosition(): ManimOutlineTreeItem | undefined {
// 		const position = this._codeEditor?.selection?.active;
// 		if (!position) {
// 			return undefined;
// 		}
// 		const lineIndex = position.line;
// 		for (const item of this._sceneTreeItems) {
// 			if (lineIndex >= item.startLine! && lineIndex < item.endLine!) {
// 				return item;
// 			}
// 		}
// 		return undefined;
// 	}
// 	private _updateTreeViewTitle() {
// 		var view = this._getTreeView();
// 		if (this._codeDocument) {
// 			const codeFileName = path.basename(this._codeDocument.uri.fsPath);
// 			view.title = 'Manim Outline: ' + codeFileName;
// 		} else {
// 			view.title = 'Manim Outline';
// 		}
// 	}
// 	private _getQuality(): string {
// 		const settings = vscode.workspace.getConfiguration('manimViewer');
// 		const quality = settings?.get<string>('renderQuality');
// 		return quality || '480p15';
// 	}
// 	private _onActiveTextEditorChanged() {
// 		// console.log('editor changed');
// 		const document = vscode.window.activeTextEditor?.document;
// 		let isPythonFile = document && this._isValidCodeDocument(document);
// 		let isManimViewer = ManimViewerPanel.currentPanel?.isActive();
// 		let isExplorerView = vscode.workspace.getConfiguration('Files', null).get('exclude', null) === null;
// 		vscode.commands.executeCommand('setContext', 'manimOutlineEnabled', isPythonFile || isManimViewer);
// 		if (isPythonFile && (document !== this._codeDocument)) {
// 			this._codeEditor = vscode.window.activeTextEditor;
// 			this.setCodeDocument(document);
// 		}
// 	}
// 	private _onTextDocumentSaved(document: vscode.TextDocument) {
// 		if (document !== this._codeDocument) {
// 			return;
// 		}
// 		this._isHandlingDocumentSave = true;
// 		// Debounce the document save event
// 		// to avoid also calling the document change event
// 		clearTimeout(this._documentSaveTimeout);
// 		this._documentSaveTimeout = setTimeout(() => this._handleTextDocumentSave(document), 100);
// 	}
// 	private _handleTextDocumentSave(document: vscode.TextDocument) {
// 		// console.log('document saved');
// 		this.refresh();
// 		this._isHandlingDocumentSave = false;
// 	}
// 	private _onTextDocumentChanged(event: vscode.TextDocumentChangeEvent) {
// 		if (this._isHandlingDocumentSave) {
// 			return;
// 		}
// 		if (event.document !== this._codeDocument) {
// 			return;
// 		}
// 		this._isHandlingDocumentChange = true;
// 		// Debounce the document change event
// 		// to avoid repeated calls during rapid typing
// 		clearTimeout(this._documentChangeTimeout);
// 		this._documentChangeTimeout = setTimeout(() => this._handleTextDocumentChange(event), 90);
// 	}
// 	private _handleTextDocumentChange(event: vscode.TextDocumentChangeEvent) {
// 		if (this._isHandlingDocumentSave) {
// 			this._isHandlingDocumentChange = false;
// 			return;
// 		}
// 		// console.log('document changed');
// 		for (const contentChange of event.contentChanges) {
// 			let numPrevLines = contentChange.range.end.line - contentChange.range.start.line + 1;
// 			let numNewLines = contentChange.text.split('\n').length;
// 			if (numNewLines !== numPrevLines) {
// 				// TODO: Smarter more efficient handling of line addition/deletion?
// 				// For now, just refresh the outline view. Dumb, but works.
// 				this.refresh();
// 				break;
// 			}
// 		}
// 		this._isHandlingDocumentChange = false;
// 	}
// 	private _onTextEditorSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
// 		if (this._isHandlingDocumentChange) {
// 			return;
// 		}
// 		if (event.textEditor.document !== this._codeDocument) {
// 			return;
// 		}
// 		this._isHandlingSelectionChange = true;
// 		// Debounce the selection change event
// 		// to avoid repeated calls during dragging selections or rapid typing
// 		clearTimeout(this._selectionChangeTimeout);
// 		this._selectionChangeTimeout = setTimeout(() => this._handleTextEditorSelectionChange(event), 80);
// 	}
// 	private _handleTextEditorSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
// 		if (this._isHandlingDocumentChange) {
// 			this._isHandlingSelectionChange = false;
// 			return;
// 		}
// 		// console.log('selection changed');
// 		const selection = event.selections[0];
// 		const lineIndex = selection.active.line;
// 		var sceneTreeItem: ManimOutlineTreeItem | undefined;
// 		for (const item of this._sceneTreeItems) {
// 			if (lineIndex >= item.startLine! && lineIndex < item.endLine!) {
// 				sceneTreeItem = item;
// 				break;
// 			}
// 		}
// 		if (sceneTreeItem) {
// 			this.setScene(sceneTreeItem);
// 		} else {
// 			// no way to clear the tree view selection as of now
// 		}
// 		this._isHandlingSelectionChange = false;
// 	}
// 	private _onFileDeleted(event: vscode.FileDeleteEvent) {
// 		// console.log('file deleted');
// 		// Clear the outline view if the deleted file is the current document
// 		if (this._codeDocument && event.files.includes(this._codeDocument.uri)) {
// 			this._codeEditor = undefined;
// 			this.setCodeDocument(undefined);
// 		}
// 	}
// 	private _onFileRenamed(event: vscode.FileRenameEvent) {
// 		// console.log('file renamed');
// 		// Update the outline view title if the renamed file is the current document
// 		if (event.files.some(file => file.oldUri === this._codeDocument?.uri)) {
// 			this._updateTreeViewTitle();
// 		}
// 	}
// 	private _parsePythonCodeForManimOutline(pythonCode: string): ManimOutlineTreeItem[] {
// 		var data: ManimOutlineTreeItem[] = [];
// 		let lines: string[] = pythonCode.split('\n');
// 		var indentLevels: number[] = [];
// 		var indentString: string = '';
// 		var inClassBlock: boolean = false;
// 		var inFunctionBlock: boolean = false;
// 		var inSceneConstructMethod: boolean = false;
// 		var isManim: boolean = false;
// 		var classItem: ManimOutlineTreeItem | undefined;
// 		var sectionNum: number = 0;
// 		var topLevelCodeLines: string[] = [];
// 		for (var i = 0; i < lines.length; i++) {
// 			const line = lines[i];
// 			const lineIndentString = line.substring(0, line.search(/\S/));
// 			if (indentString === '' && lineIndentString !== '') {
// 				indentString = lineIndentString;
// 			}
// 			let indentLevel = lineIndentString === '' ? 0 : lineIndentString.length / indentString.length;
// 			indentLevels.push(indentLevel);
// 			if (!inClassBlock && !inFunctionBlock && line.trim() !== '' && !line.startsWith('class ') && !line.startsWith('def ')) {
// 				topLevelCodeLines.push(line);
// 			}
// 			if (isManim === false) {
// 				if (line.startsWith('from manim import ')) {
// 					isManim = true;
// 					continue;
// 				}
// 			}
// 			if (line.startsWith('class ')) {
// 				inClassBlock = true;
// 				inFunctionBlock = false;
// 				inSceneConstructMethod = false;
// 				// end previous class item
// 				if (classItem !== undefined) {
// 					classItem.endLine = i;
// 					classItem = undefined;
// 				}
// 				// init new class item
// 				const className = line.substring(6).split('(')[0].trim();
// 				classItem = new ManimOutlineTreeItem(className, this._sceneIconPath);
// 				classItem.startLine = i;
// 			} else if (line.startsWith('def ')) {
// 				inClassBlock = false;
// 				inFunctionBlock = true;
// 				inSceneConstructMethod = false;
// 				// end previous class item
// 				if (classItem !== undefined) {
// 					classItem.endLine = i;
// 					classItem = undefined;
// 				}
// 			} else if (inClassBlock && (indentLevel === 1) && (line.trim() === 'def construct(self):')) {
// 				inFunctionBlock = true;
// 				inSceneConstructMethod = true;
// 				// should always have a class item here
// 				data.push(classItem ? classItem : new ManimOutlineTreeItem(''));
// 				sectionNum = 0;
// 			} else if (inClassBlock && (indentLevel === 1) && line.trim().startsWith('def ')) {
// 				inFunctionBlock = true;
// 				inSceneConstructMethod = false;
// 			// } else if (indentLevel === 2 && inSceneConstructMethod) {
// 			// 	if (line.trim().startsWith('self.next_section(')) {
// 			// 		var sectionName: string = sectionNum.toString().padStart(4, '0');
// 			// 		const firstChar = line.indexOf('(') + 1;
// 			// 		const lastChar = line.indexOf(')') - 1;
// 			// 		const args = line.substring(firstChar, lastChar + 1).split(',');
// 			// 		for (const [index, arg] of args.entries()) {
// 			// 			if (arg.includes('=')) {
// 			// 				const keyvalue = arg.split('=');
// 			// 				const key = keyvalue[0].trim();
// 			// 				if (key === 'name') {
// 			// 					const value = keyvalue[1].trim();
// 			// 					sectionName += ' ' + value.substring(1, value.length - 1);
// 			// 					break;
// 			// 				}
// 			// 			} else if (index === 0) {
// 			// 				sectionName += ' ' + arg.substring(1, arg.length - 1);
// 			// 				break;
// 			// 			}
// 			// 		}
// 			// 		// data[data.length - 1].children.push(new ManimOutlineTreeItem(sectionName, this._sectionIconPath));
// 			// 		sectionNum++;
// 			} else if (indentLevel === 0 && line.trim() !== '') {
// 				inClassBlock = false;
// 				inFunctionBlock = false;
// 				inSceneConstructMethod = false;
// 				// end previous class item
// 				if (classItem !== undefined) {
// 					classItem.endLine = i;
// 					classItem = undefined;
// 				}
// 			}
// 		}
// 		if (!isManim) {
// 			return [];
// 		}
// 		if (data.length > 0 && data[data.length - 1].endLine === undefined) {
// 			data[data.length - 1].endLine = lines.length;
// 		}
// 		data.forEach(element => {
// 			var codeLines: string[] = topLevelCodeLines.slice();
// 			lines.slice(element.startLine, element.endLine).forEach(line => {
// 				line = line.trimEnd();
// 				if (line.trim() !== '') {
// 					codeLines.push(line);
// 				}
// 			});
// 			element.code = codeLines.join('\n');
// 			if (element.children.length > 0) {
// 				element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
// 			}
// 			element.children.forEach(child => {
// 				child.parent = element;
// 			});
// 		});
// 		return data;
// 	}
// 	getTreeItem(element: ManimOutlineTreeItem): vscode.TreeItem {
// 		return element;
// 	}
// 	getParent(element: ManimOutlineTreeItem): ManimOutlineTreeItem | null {
// 		return element.parent;
// 	}
// 	getChildren(element?: ManimOutlineTreeItem | undefined): Thenable<ManimOutlineTreeItem[]> {
// 		if (element === undefined) {
// 			return Promise.resolve(this._sceneTreeItems);
// 		}
// 		return Promise.resolve(element.children);
// 	}
// }
// class ManimOutlineTreeItem extends vscode.TreeItem {
// 	parent: ManimOutlineTreeItem | null = null;
// 	children: ManimOutlineTreeItem[] = [];
// 	startLine: number | undefined;
// 	endLine: number | undefined;
// 	code: string | undefined;
// 	constructor(label: string, iconPath?: any) {
// 		const collapsibleState = vscode.TreeItemCollapsibleState.None;
// 		super(label, collapsibleState);
// 		if (iconPath !== undefined) {
// 			this.iconPath = iconPath;
// 		}
// 	}
// 	command = {
// 		command: "manimViewer.selectTreeItem",
// 		title: "Select Scene/Section",
// 		arguments: [this]
// 	};
// }
//# sourceMappingURL=extension.js.map