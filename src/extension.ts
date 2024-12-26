// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "manim-viewer" is now active!');

	// Open extension settings
	context.subscriptions.push(
		vscode.commands.registerCommand('manimViewer.settings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'Manim Viewer');
		})
	);

	// Manim outline view in explorer sidebar
	const manimOutlineProvider = new ManimOutlineProvider(context);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(ManimOutlineProvider.viewType, manimOutlineProvider)
	);

	// Refresh manim outline view
	context.subscriptions.push(
		vscode.commands.registerCommand('manimViewer.refresh', () => {
			manimOutlineProvider.refresh();
		})
	);

	// Select item in manim outline view
	context.subscriptions.push(
		vscode.commands.registerCommand("manimViewer.selectTreeItem", (item: ManimOutlineTreeItem) => {
			manimOutlineProvider.onTreeItemSelected(item);
		})
	);

	// Collapse all items in manim outline view
	context.subscriptions.push(
		vscode.commands.registerCommand('manimViewer.collapseAll', () => {
			manimOutlineProvider.collapseAll();
		})
	);

	// Show viewer webview panel
	context.subscriptions.push(
		vscode.commands.registerCommand('manimViewer.showViewer', () => {
			ManimViewerPanel.createOrShow(context.extensionUri);
			manimOutlineProvider.refresh();
		})
	);

	// Render scene in viewer webview panel
	context.subscriptions.push(
		vscode.commands.registerCommand('manimViewer.renderScene', (node?: ManimOutlineTreeItem) => {
			if (node) {
				ManimViewerPanel.createOrShow(context.extensionUri);
				manimOutlineProvider.setScene(node, true);
			}
		})
	);

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
export function deactivate() {
	if (ManimViewerPanel.currentPanel) {
		ManimViewerPanel.currentPanel.clearTerminal();
	}
}

// const Singleton = (function () {
// 	let instance;

// 	function createInstance() {
// 		const object = new Object("I am the instance");
// 		return object;
// 	}

// 	return {
// 		getInstance: function () {
// 			if (!instance) {
// 				instance = createInstance();
// 			}
// 			return instance;
// 		}
// 	};
// })();

class ManimOutlineProvider implements vscode.TreeDataProvider<ManimOutlineTreeItem> {

	public static readonly viewType = 'manimOutline';

	private _onDidChangeTreeData: vscode.EventEmitter<ManimOutlineTreeItem | undefined | void> = new vscode.EventEmitter<ManimOutlineTreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<ManimOutlineTreeItem | undefined | void> = this._onDidChangeTreeData.event;

	private _codeEditor: vscode.TextEditor | undefined;
	private _codeDocument: vscode.TextDocument | undefined;
	private _sceneName: string | undefined;
	private _videoUri: vscode.Uri | undefined;

	private _sceneTreeItems: ManimOutlineTreeItem[] = [];
	private _sceneIconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'symbol-interface.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'symbol-interface.svg')
	};

	// for debouncing async events
	private _isHandlingDocumentSave: boolean = false;
	private _isHandlingDocumentChange: boolean = false;
	private _isHandlingSelectionChange: boolean = false;
	private _documentSaveTimeout: NodeJS.Timeout | string | number | undefined;
	private _documentChangeTimeout: NodeJS.Timeout | string | number | undefined;
	private _selectionChangeTimeout: NodeJS.Timeout | string | number | undefined;

	constructor(private context: vscode.ExtensionContext) {
		vscode.window.onDidChangeActiveTextEditor(() => this._onActiveTextEditorChanged());
		vscode.workspace.onDidSaveTextDocument((document) => this._onTextDocumentSaved(document));
		vscode.workspace.onDidChangeTextDocument(event => this._onTextDocumentChanged(event));
		vscode.window.onDidChangeTextEditorSelection((event) => this._onTextEditorSelectionChanged(event));
		vscode.workspace.onDidDeleteFiles((event) => this._onFileDeleted(event));
		vscode.workspace.onDidRenameFiles((event) => this._onFileRenamed(event));
		// this.onDidChangeTreeData(() => this._onTreeDataChanged());

		this._onActiveTextEditorChanged();
	}

	private _getTreeView(): vscode.TreeView<ManimOutlineTreeItem> {
		return vscode.window.createTreeView(ManimOutlineProvider.viewType, { treeDataProvider: this });
	}

	refresh() {
		// console.log('refresh');
		this.setCodeDocument(this._codeDocument);
	}

	collapseAll() {
		vscode.commands.executeCommand('workbench.actions.treeView.' + ManimOutlineProvider.viewType + '.collapseAll');
	}

	onTreeItemSelected(item: ManimOutlineTreeItem) {
		this._setCursorPositionToScene(item);
		this.setScene(item);
	}

	setCodeDocument(document: vscode.TextDocument | undefined) {
		// console.log('set code document');
		this._codeDocument = document;

		// reset outline tree
		const contents = this._codeDocument?.getText();
		this._sceneTreeItems = contents ? this._parsePythonCodeForManimOutline(contents) : [];

		let sceneTreeItem = this._getSceneTreeItemFromCursorPosition();
		if (sceneTreeItem) {
			this.setScene(sceneTreeItem);
		} else {
			// TODO: set scene based on stored state

			// if not set based on stored state, clear the scene
			this.setScene(undefined);
		}

		// update outline view title
		this._updateTreeViewTitle();

		// needed?
		this._onDidChangeTreeData.fire();
	}

	setScene(scene: ManimOutlineTreeItem | string | undefined, forceRender: boolean = false) {
		// console.log('set scene');
		var sceneTreeItem: ManimOutlineTreeItem | undefined;
		if (scene instanceof ManimOutlineTreeItem) {
			sceneTreeItem = scene;
			this._sceneName = sceneTreeItem.label?.toString();
		} else {
			this._sceneName = this._isValidSceneName(scene) ? scene : undefined;
			sceneTreeItem = this._getSceneTreeItemFromName(this._sceneName);
		}
		// update tree selection
		if (sceneTreeItem) {
			this._getTreeView().reveal(sceneTreeItem, {select: true});
		}
		this._videoUri = this._getVideoUri();

		if (ManimViewerPanel.currentPanel === undefined) {
			return;
		}
		ManimViewerPanel.currentPanel.refresh(this._videoUri);

		if (this._videoUri === undefined) {
			return;
		}
		if (forceRender || !this._isExistingFile(this._videoUri?.fsPath)) {
			this.renderScene();
			return;
		}
		if (!this._isHandlingDocumentSave && (this._isHandlingDocumentChange || this._isHandlingSelectionChange)) {
			return;
		}
		// check cached code to see if there is anything new to render
		if (this._sceneName && sceneTreeItem) {
			const videoCodeUri = this._getVideoCodeUri(this._videoUri);
			if (videoCodeUri && this._isExistingFile(videoCodeUri.fsPath)) {
				try {
					const sceneCode = JSON.parse(fs.readFileSync(videoCodeUri.fsPath, 'utf8'));
					const cachedSceneCode = sceneCode[this._sceneName];
					const currentSceneCode = sceneTreeItem.code;
					// console.log('Cached:\n' + cachedSceneCode);
					// console.log('Current:\n' + currentSceneCode);
					if (cachedSceneCode === currentSceneCode) {
						// console.log('Scene code is already up to date');
						return;
					}
				} catch (err) {
				}
			}
		}
		this.renderScene();
	}

	renderScene(sceneName?: string) {
		if (ManimViewerPanel.currentPanel) {
			const codeFilePath = this._codeDocument?.uri.fsPath;
			if (sceneName === undefined) {
				sceneName = this._sceneName;
			}
			if (codeFilePath && sceneName) {
				// console.log('rendering scene');
				const codeFileDir = path.dirname(codeFilePath);
				const codeFileName = path.basename(codeFilePath);
				const quality = this._getQuality();
				const qualityFlags: { [key: string]: string } = {
					"480p15": "l",
					"720p30": "m",
					"1080p60": "h",
					"1440p60": "p",
					"2160p60": "k"
				};
				const qualityFlag = qualityFlags[quality];
				var videoFilePath = this._videoUri?.fsPath;
				if (videoFilePath === undefined) {
					const codeFileNameNoExt = path.basename(codeFilePath, '.py');
					videoFilePath = path.join(codeFileDir, 'media', 'videos', codeFileNameNoExt, quality, sceneName + '.mp4');
				}

				const terminal: vscode.Terminal = ManimViewerPanel.currentPanel.getTerminal();
				// TODO: use videoUri
				// For now, manim's default output path should be the same as the videoUri.
				terminal.sendText(`cd ${codeFileDir}; manim --quality=${qualityFlag} ${codeFileName} ${sceneName}`);

				// store scene code for rendered video
				const videoDir = path.dirname(videoFilePath);
				const sceneCodeFilePath = path.join(videoDir, 'manimViewer.json');
				var sceneCode: {[key: string]: any} = {}; // stupid typescript
				if (this._isExistingFile(sceneCodeFilePath)) {
					sceneCode = JSON.parse(fs.readFileSync(sceneCodeFilePath, 'utf8'));
				}
				// console.log(sceneCode);
				const sceneTreeItem = this._sceneTreeItems.find(item => item.label === sceneName);
				if (sceneTreeItem) {
					sceneCode[sceneName] = sceneTreeItem.code;
					fs.writeFileSync(sceneCodeFilePath, JSON.stringify(sceneCode, null, 4));
				}

				// clean up partial movie files
				this._cleanUpPartialMovieFiles(videoDir, sceneName);
			}
		}
	}

	getCurrentSceneName(): string | undefined {
		return this._sceneName;
	}

	private _getVideoUri(): vscode.Uri | undefined {
		if (this._codeDocument === undefined || this._sceneName === undefined) {
			return undefined;
		}
		const codeFilePath = this._codeDocument.uri.fsPath;
		const codeFileDir = path.dirname(codeFilePath);
		const codeFileName = path.basename(codeFilePath, '.py');
		const quality = this._getQuality();
		const videoFileDir = path.join(codeFileDir, 'media', 'videos', codeFileName, quality);
		const videoFileName = this._sceneName + '.mp4';
		const videoFilePath = path.join(videoFileDir, videoFileName);
		return vscode.Uri.file(videoFilePath);
	}

	private _getVideoCodeUri(videoUri: vscode.Uri | undefined): vscode.Uri | undefined {
		if (videoUri === undefined) {
			return undefined;
		}
		const videoDir = path.dirname(videoUri.fsPath);
		const videoCodeFilePath = path.join(videoDir, 'manimViewer.json');
		return vscode.Uri.file(videoCodeFilePath);
	}

	private _cleanUpPartialMovieFiles(videoDir: string, sceneName: string | undefined) {
		// console.log('clean up partial movie files');
		let partialMovieFilesDir = path.join(videoDir, 'partial_movie_files');
		// console.log(partialMovieFilesDir);
		if (!this._isExistingDirectory(partialMovieFilesDir)) {
			return;
		}
		const sceneDirNames = fs.readdirSync(partialMovieFilesDir);
		// console.log(sceneDirNames);
		for (const sceneDirName of sceneDirNames) {
		  const sceneDir = path.join(partialMovieFilesDir, sceneDirName);
		  const stat = fs.statSync(sceneDir);
		  if (stat.isDirectory()) {
			if (sceneName === undefined || sceneDirName === sceneName) {
				var partialMovieFiles: string[] = [];
				var listedPartialMovieFiles: string[] = [];
				const sceneFileNames = fs.readdirSync(sceneDir);
				// console.log(sceneFileNames);
				for (const sceneFileName of sceneFileNames) {
				  const sceneFilePath = path.join(sceneDir, sceneFileName);
				  const stat = fs.statSync(sceneFilePath);
				  if (stat.isFile()) {
					if (sceneFileName.endsWith('.mp4')) {
					  partialMovieFiles.push(sceneFilePath);
					} else if (sceneFileName === 'partial_movie_file_list.txt') {
					  const data = fs.readFileSync(sceneFilePath, 'utf8');
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
					fs.unlinkSync(partialMovieFile);
				  }
				}
			}
			if (sceneDirName === sceneName) {
				break;
			}
		  }
		}
	}
	
	private _isExistingFile(path: fs.PathLike | undefined): boolean {
		if (path === undefined) {
			return false;
		}
		try {
			fs.accessSync(path);
			return true;
		} catch (err) {
			return false;
		}
	}

	private _isExistingDirectory(path: fs.PathLike | undefined): boolean {
		if (path === undefined) {
			return false;
		}
		try {
		  return fs.statSync(path).isDirectory();
		} catch (err) {
		  return false;
		}
	  }

	private _isValidCodeDocument(document: vscode.TextDocument): boolean {
		const isFile = document.uri.scheme === 'file';
		const isPython = document.languageId === 'python';
		if (!isFile || !isPython) {
			return false;
		}
		return this._isExistingFile(document.uri.fsPath);
	}

	private _isValidSceneName(sceneName: string | undefined): boolean {
		if (sceneName === undefined) {
			return false;
		}
		return this._sceneTreeItems.some(item => item.label === sceneName);
	}

	private _getSceneTreeItemFromName(sceneName: string | undefined): ManimOutlineTreeItem | undefined {
		if (sceneName === undefined) {
			return undefined;
		}
		return this._sceneTreeItems.find(item => item.label === sceneName);
	}

	private _setCursorPositionToScene(scene: ManimOutlineTreeItem | string | undefined) {
		if (scene instanceof ManimOutlineTreeItem) {
			if (this._codeEditor) {
				const position = this._codeEditor.selection.active;
				var newPosition = position.with(scene.startLine, 0);
				var newSelection = new vscode.Selection(newPosition, newPosition);
				this._codeEditor.selection = newSelection;
			}
		} else if (typeof scene === "string") {
			const sceneItem = this._sceneTreeItems.find(item => item.label === scene);
			if (sceneItem) {
				this._setCursorPositionToScene(sceneItem);
			}
		}
	}

	private _getSceneTreeItemFromCursorPosition(): ManimOutlineTreeItem | undefined {
		const position = this._codeEditor?.selection?.active;
		if (!position) {
			return undefined;
		}
		const lineIndex = position.line;
		for (const item of this._sceneTreeItems) {
			if (lineIndex >= item.startLine! && lineIndex < item.endLine!) {
				return item;
			}
		}
		return undefined;
	}

	private _updateTreeViewTitle() {
		var view = this._getTreeView();
		if (this._codeDocument) {
			const codeFileName = path.basename(this._codeDocument.uri.fsPath);
			view.title = 'Manim Outline: ' + codeFileName;
		} else {
			view.title = 'Manim Outline';
		}
	}

	private _getQuality(): string {
		const settings = vscode.workspace.getConfiguration('Manim Viewer');
		const quality = settings?.get<string>('manimViewer.renderQuality') || '480p15';
		return quality;
	}

	private _onActiveTextEditorChanged() {
		// console.log('editor changed');
		const document = vscode.window.activeTextEditor?.document;
		let isPythonFile = document && this._isValidCodeDocument(document);
		let isManimViewer = ManimViewerPanel.currentPanel?.isActive();
		vscode.commands.executeCommand('setContext', 'manimOutlineEnabled', isPythonFile || isManimViewer);
		if (isPythonFile && (document !== this._codeDocument)) {
			this._codeEditor = vscode.window.activeTextEditor;
			this.setCodeDocument(document);
		}
	}

	private _onTextDocumentSaved(document: vscode.TextDocument) {
		if (document !== this._codeDocument) {
			return;
		}
		this._isHandlingDocumentSave = true;
		// Debounce the document save event
		// to avoid also calling the document change event
		clearTimeout(this._documentSaveTimeout);
		this._documentSaveTimeout = setTimeout(() => this._handleTextDocumentSave(document), 100);
	}

	private _handleTextDocumentSave(document: vscode.TextDocument) {
		// console.log('document saved');
		this.refresh();
		this._isHandlingDocumentSave = false;
	}

	private _onTextDocumentChanged(event: vscode.TextDocumentChangeEvent) {
		if (this._isHandlingDocumentSave) {
			return;
		}
		if (event.document !== this._codeDocument) {
			return;
		}
		this._isHandlingDocumentChange = true;
		// Debounce the document change event
		// to avoid repeated calls during rapid typing
		clearTimeout(this._documentChangeTimeout);
		this._documentChangeTimeout = setTimeout(() => this._handleTextDocumentChange(event), 90);
	}

	private _handleTextDocumentChange(event: vscode.TextDocumentChangeEvent) {
		if (this._isHandlingDocumentSave) {
			this._isHandlingDocumentChange = false;
			return;
		}
		// console.log('document changed');
		for (const contentChange of event.contentChanges) {
			let numPrevLines = contentChange.range.end.line - contentChange.range.start.line + 1;
			let numNewLines = contentChange.text.split('\n').length;
			if (numNewLines !== numPrevLines) {
				// TODO: Smarter more efficient handling of line addition/deletion?
				// For now, just refresh the outline view. Dumb, but works.
				this.refresh();
				break;
			}
		}
		this._isHandlingDocumentChange = false;
	}

	private _onTextEditorSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
		if (this._isHandlingDocumentChange) {
			return;
		}
		if (event.textEditor.document !== this._codeDocument) {
			return;
		}
		this._isHandlingSelectionChange = true;
		// Debounce the selection change event
		// to avoid repeated calls during dragging selections or rapid typing
		clearTimeout(this._selectionChangeTimeout);
		this._selectionChangeTimeout = setTimeout(() => this._handleTextEditorSelectionChange(event), 80);
	}

	private _handleTextEditorSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
		if (this._isHandlingDocumentChange) {
			this._isHandlingSelectionChange = false;
			return;
		}
		// console.log('selection changed');
		const selection = event.selections[0];
		const lineIndex = selection.active.line;
		var sceneTreeItem: ManimOutlineTreeItem | undefined;
		for (const item of this._sceneTreeItems) {
			if (lineIndex >= item.startLine! && lineIndex < item.endLine!) {
				sceneTreeItem = item;
				break;
			}
		}
		if (sceneTreeItem) {
			this.setScene(sceneTreeItem);
		} else {
			// no way to clear the tree view selection as of now
		}
		this._isHandlingSelectionChange = false;
	}
	
	private _onFileDeleted(event: vscode.FileDeleteEvent) {
		// console.log('file deleted');
		// Clear the outline view if the deleted file is the current document
		if (this._codeDocument && event.files.includes(this._codeDocument.uri)) {
			this._codeEditor = undefined;
			this.setCodeDocument(undefined);
		}
	}

	private _onFileRenamed(event: vscode.FileRenameEvent) {
		// console.log('file renamed');
		// Update the outline view title if the renamed file is the current document
		if (event.files.some(file => file.oldUri === this._codeDocument?.uri)) {
			this._updateTreeViewTitle();
		}
	}

	private _parsePythonCodeForManimOutline(pythonCode: string): ManimOutlineTreeItem[] {
		var data: ManimOutlineTreeItem[] = [];
		let lines: string[] = pythonCode.split('\n');
		var indentLevels: number[] = [];
		var indentString: string = '';
		var inClassBlock: boolean = false;
		var inFunctionBlock: boolean = false;
		var inSceneConstructMethod: boolean = false;
		var isManim: boolean = false;
		var classItem: ManimOutlineTreeItem | undefined;
		var sectionNum: number = 0;
		var topLevelCodeLines: string[] = [];
		for (var i = 0; i < lines.length; i++) {
			const line = lines[i];

			const lineIndentString = line.substring(0, line.search(/\S/));
			if (indentString === '' && lineIndentString !== '') {
				indentString = lineIndentString;
			}
			let indentLevel = lineIndentString === '' ? 0 : lineIndentString.length / indentString.length;
			indentLevels.push(indentLevel);

			if (!inClassBlock && !inFunctionBlock && line.trim() !== '' && !line.startsWith('class ') && !line.startsWith('def ')) {
				topLevelCodeLines.push(line);
			}

			if (isManim === false) {
				if (line.startsWith('from manim import ')) {
					isManim = true;
					continue;
				}
			}

			if (line.startsWith('class ')) {
				inClassBlock = true;
				inFunctionBlock = false;
				inSceneConstructMethod = false;
				// end previous class item
				if (classItem !== undefined) {
					classItem.endLine = i;
					classItem = undefined;
				}
				// init new class item
				const className = line.substring(6).split('(')[0].trim();
				classItem = new ManimOutlineTreeItem(className, this._sceneIconPath);
				classItem.startLine = i;
			} else if (line.startsWith('def ')) {
				inClassBlock = false;
				inFunctionBlock = true;
				inSceneConstructMethod = false;
				// end previous class item
				if (classItem !== undefined) {
					classItem.endLine = i;
					classItem = undefined;
				}
			} else if (inClassBlock && (indentLevel === 1) && (line.trim() === 'def construct(self):')) {
				inFunctionBlock = true;
				inSceneConstructMethod = true;
				// should always have a class item here
				data.push(classItem ? classItem : new ManimOutlineTreeItem(''));
				sectionNum = 0;
			} else if (inClassBlock && (indentLevel === 1) && line.trim().startsWith('def ')) {
				inFunctionBlock = true;
				inSceneConstructMethod = false;
			// } else if (indentLevel === 2 && inSceneConstructMethod) {
			// 	if (line.trim().startsWith('self.next_section(')) {
			// 		var sectionName: string = sectionNum.toString().padStart(4, '0');
			// 		const firstChar = line.indexOf('(') + 1;
			// 		const lastChar = line.indexOf(')') - 1;
			// 		const args = line.substring(firstChar, lastChar + 1).split(',');
			// 		for (const [index, arg] of args.entries()) {
			// 			if (arg.includes('=')) {
			// 				const keyvalue = arg.split('=');
			// 				const key = keyvalue[0].trim();
			// 				if (key === 'name') {
			// 					const value = keyvalue[1].trim();
			// 					sectionName += ' ' + value.substring(1, value.length - 1);
			// 					break;
			// 				}
			// 			} else if (index === 0) {
			// 				sectionName += ' ' + arg.substring(1, arg.length - 1);
			// 				break;
			// 			}
			// 		}
			// 		// data[data.length - 1].children.push(new ManimOutlineTreeItem(sectionName, this._sectionIconPath));
			// 		sectionNum++;
			} else if (indentLevel === 0 && line.trim() !== '') {
				inClassBlock = false;
				inFunctionBlock = false;
				inSceneConstructMethod = false;
				// end previous class item
				if (classItem !== undefined) {
					classItem.endLine = i;
					classItem = undefined;
				}
			}
		}
		if (!isManim) {
			return [];
		}
		if (data.length > 0 && data[data.length - 1].endLine === undefined) {
			data[data.length - 1].endLine = lines.length;
		}
		data.forEach(element => {
			var codeLines: string[] = topLevelCodeLines.slice();
			lines.slice(element.startLine, element.endLine).forEach(line => {
				line = line.trimEnd();
				if (line.trim() !== '') {
					codeLines.push(line);
				}
			});
			element.code = codeLines.join('\n');

			if (element.children.length > 0) {
				element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			element.children.forEach(child => {
				child.parent = element;
			});
		});
		return data;
	}

	getTreeItem(element: ManimOutlineTreeItem): vscode.TreeItem {
		return element;
	}

	getParent(element: ManimOutlineTreeItem): ManimOutlineTreeItem | null {
		return element.parent;
	}

	getChildren(element?: ManimOutlineTreeItem | undefined): Thenable<ManimOutlineTreeItem[]> {
		if (element === undefined) {
			return Promise.resolve(this._sceneTreeItems);
		}
		return Promise.resolve(element.children);
	}
}

class ManimOutlineTreeItem extends vscode.TreeItem {

	parent: ManimOutlineTreeItem | null = null;
	children: ManimOutlineTreeItem[] = [];
	startLine: number | undefined;
	endLine: number | undefined;
	code: string | undefined;

	constructor(label: string, iconPath?: { light: string; dark: string; }) {
		const collapsibleState = vscode.TreeItemCollapsibleState.None;
		super(label, collapsibleState);
		if (iconPath !== undefined) {
			this.iconPath = iconPath;
		}
	}

	command = {
		command: "manimViewer.selectTreeItem",
		title: "Select Scene/Section",
		arguments: [this]
	};
}

class ManimViewerPanel {

	public static currentPanel: ManimViewerPanel | undefined;

	public static readonly viewType = 'manimViewerPanel';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	private _videoUri: vscode.Uri | undefined;
	private _terminal: vscode.Terminal | undefined;

	refresh(videoUri?: vscode.Uri | undefined) {
		// update video file?
		if (videoUri) {
			this._videoUri = videoUri;
		}
		// update webview content
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);
	}

	public isActive(): boolean {
		return this._panel.active;
	}

	public getTerminal(): vscode.Terminal {
		if (this._terminal) {
			return this._terminal;
		}

		// Create the terminal
		this._terminal = vscode.window.createTerminal('Manim Viewer');

		// Update this panel whenever the terminal is done executing
		vscode.window.onDidEndTerminalShellExecution(async (event) => {
			if (event.terminal === this._terminal) {
				this.refresh();
			}
		});

		// Dispose if the terminal is closed
		vscode.window.onDidCloseTerminal(async (event) => {
			if (event.name === 'Manim Viewer') {
				this._terminal = undefined;
			}
		});

		return this._terminal;
	}

	public clearTerminal() {
		if (this._terminal) {
			this._terminal.dispose();
			this._terminal = undefined;
		}
	}
	
	public static createOrShow(extensionUri: vscode.Uri) {
		// const column = vscode.window.activeTextEditor
		// 	? vscode.window.activeTextEditor.viewColumn
		// 	: undefined;

		// If we already have a panel, show it.
		if (ManimViewerPanel.currentPanel) {
			ManimViewerPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			ManimViewerPanel.viewType,
			'Manim Viewer',
			vscode.ViewColumn.Beside,
			getWebviewOptions(extensionUri),
		);

		ManimViewerPanel.currentPanel = new ManimViewerPanel(panel, extensionUri);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		ManimViewerPanel.currentPanel = new ManimViewerPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		// Setup the terminal
		this._terminal = this.getTerminal();

		// Set the webview's initial html content
		this.refresh();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
	}

	public dispose() {
		ManimViewerPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();
		if (this._terminal) {
			this._terminal.dispose();
		}

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js');

		// And the uri we use to load this script in the webview
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		// Local path to css styles
		const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css');
		const stylesPathMainPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css');

		// Uri to load styles into webview
		const stylesResetUri = webview.asWebviewUri(styleResetPath);
		const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		// Video file uri and path relative to workspace root
		const videoWebviewUri = this._videoUri ? webview.asWebviewUri(this._videoUri) : undefined;
		var relVideoFilePath = this._videoUri?.fsPath;
		if (this._videoUri) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._videoUri);
			if (workspaceFolder) {
				relVideoFilePath = path.relative(workspaceFolder.uri.fsPath, this._videoUri.fsPath);
			}
		}

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

				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">

				<title>Manim Viewer</title>
			</head>
			<body>
				<span id="video-filepath">${relVideoFilePath || 'No video selected'}</span><br />
				<video controls autoplay loop muted playsinline>
					<source src="${videoWebviewUri || ''}" type="video/mp4">
				</video>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		// Enable javascript in the webview
		enableScripts: true,

		// And restrict the webview to only loading content from our extension's `media` directory.
		// localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
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
