# Change Log

All notable changes to the "manim-viewer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## v1.0.0
Initial release

## v2.0.0
Major changes and improvements!

No more manim outline view, now everything is in the webview panel. Although I rather liked the manim outline view, it was causing some annoying behavior by constantly popping up the view whenever a new scene was selected even if the file explorer view was not currently active. As far as I can tell, the VSCode extension API does not allow for controlling this, so I ditched it in favor of a new really simple and intuitive webview UI.

Live video up-to-date status indicator. The prior version was a little over zeleous in auto-rendering scences every time they were selected. I toned this down so that rendering only happens on saving the file (optional) or when the Render button is clicked. To ensure no confusion regarding out-of-date videos after a scene's code has changed, the UI now shows a live status of the selected scene video with respect to its source code. This way, it is always clear if you are looking at a stale scene video or not.

I made auto-selecting the scene via the cursor optional. I typically like this behavior, but in a few cases I found it annoying. Now you can easily toggle it via the UI.

Although not currently utilized, I added functionality for rendering scenes in the background. This will be for future features.

## v2.0.1
Handle file deletion and file rename events.

Fix bug for filenames with spaces.
