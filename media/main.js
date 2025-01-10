// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode = acquireVsCodeApi();

    const videoFilePath = /** @type {HTMLDivElement} */ (document.getElementById('video-filepath'));
    const videoPlayer = /** @type {HTMLVideoElement} */ (document.getElementById('video-player'));
    // const videoSource = /** @type {HTMLSourceElement} */ (document.getElementById('video-source'));
    const videoStatusIcon = /** @type {HTMLImageElement} */ (document.getElementById('video-status-icon'));
    const videoStatusText = /** @type {HTMLDivElement} */ (document.getElementById('video-status-text'));

    const codeFilePath = /** @type {HTMLDivElement} */ (document.getElementById('code-filepath'));
    const sceneSelect = /** @type {HTMLSelectElement} */ (document.getElementById('scene-select'));
    const renderButton = /** @type {HTMLButtonElement} */ (document.getElementById('render-button'));
    const autoSelectSceneCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('auto-select-scene-checkbox'));
    const settingsButton = /** @type {HTMLButtonElement} */ (document.getElementById('settings-button'));

    videoPlayer.onmouseenter = () => {
        videoPlayer.setAttribute('controls', 'controls');
    };

    videoPlayer.onmouseleave = () => {
        videoPlayer.removeAttribute('controls');
    };

    sceneSelect.onchange = () => {
        vscode.postMessage({
            command: 'selectScene',
            scene: sceneSelect.value
        });
    };

    renderButton.onclick = () => {
        vscode.postMessage({
            command: 'renderScene',
            scene: sceneSelect.value,
            forceRender: true,
            renderInBackground: false
        });
    };

    autoSelectSceneCheckbox.onchange = () => {
        vscode.postMessage({
            command: 'autoSelectScene',
            value: autoSelectSceneCheckbox.checked
        });
    };

    settingsButton.onclick = () => {
        vscode.postMessage({
            command: 'openSettings'
        });
    };

    // Handle messages sent from the extension to the webview
    // !!! NOT USING THIS RIGHT NOW !!! Instead, we reset the webview HTML every time we need to update.
    // This is because it doesn't appear to be possible to change the video source frome here?
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'setCode':
                codeFilePath.innerText = message.codeFilePath;
                var optionsHTML = '';
                for (const scene of message.scenes) {
                    const isSelected = message.selectedScene ? message.selectedScene === scene : false;
                    optionsHTML += `<option value="${scene}" ${isSelected ? 'selected' : ''}>${scene}</option>`;
                }
                sceneSelect.innerHTML = optionsHTML;
                break;
            case 'setScene':
                sceneSelect.value = message.scene;
                break;
            case 'setVideo':
                videoFilePath.innerText = message.videoFilePath;
                break;
            case 'setVideoStatus':
                videoStatusText.innerText = message.videoStatusText;
                videoStatusIcon.src = message.videoStatusIconPath;
                break;
        }
    });
}());
