/**
 * The diagram PICTURE service (🔒 YAZ-1802 D9): one hidden iframe in the renderer loads
 * `yaseen-render.html`, posts `{ id, xml, theme, adaptive, format, scale, padding, maxWidth?, maxHeight? }`
 * and gets back `{ id, ok: true, dataUrl }` — the diagram's FIRST page drawn by draw.io's own viewer
 * (`viewer-static.min.js`), as an SVG or a PNG data URL — or `{ id, ok: false, error }`. `dataUrl`
 * is `''` for a page with nothing on it. `maxWidth` / `maxHeight` shrink the drawing to fit (a
 * preview); without them it is drawn at `scale` (an export).
 *
 * ONE PICTURE, TWO ENCODINGS: the PNG is the finished SVG — fonts and images already inside it —
 * drawn onto a canvas, draw.io's own `exportToCanvas` technique; Chromium lets a canvas be read
 * back after drawing an SVG whose HTML labels are `foreignObject` (draw.io checks exactly that, in
 * `Editor.useCanvasForExport`). So a preview, a history picture and an exported image never differ.
 *
 * Messages are JSON strings (draw.io's own `proto=json` convention) and are accepted only from
 * the parent frame; the answer goes back to the parent alone.
 */
(function()
{
	// One viewer for the page's life: `setGraphXml` resets it per request, and the fonts it embeds
	// as data URIs are fetched once (draw.io's `Editor` keeps them in `cachedFonts`).
	var container = document.createElement('div');
	container.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;';
	document.body.appendChild(container);
	var graph = new Graph(container);
	var editor = new Editor(true, null, null, graph);

	function firstPage(xml)
	{
		var node = mxUtils.parseXml(xml).documentElement;

		if (node != null && node.nodeName == 'mxfile')
		{
			var diagrams = node.getElementsByTagName('diagram');
			node = (diagrams.length > 0) ? Editor.parseDiagramNode(diagrams[0]) : null;
		}

		if (node == null || node.nodeName != 'mxGraphModel')
		{
			throw new Error('not a draw.io diagram');
		}

		return node;
	}

	/**
	 * The `@font-face` rules of `fontCss` — one per line, as packDrawio writes `yaseen-fonts/fonts.css` —
	 * whose family `svgXml` names: a picture carries the faces it draws with, not all twelve (≈0.8 MB
	 * as data URIs, in every cached preview).
	 */
	function usedFontCss(fontCss, svgXml)
	{
		return fontCss.split('\n').filter(function(rule)
		{
			var family = /font-family:\s*'([^']+)'/.exec(rule);

			return family != null && svgXml.indexOf(family[1]) >= 0;
		}).join('\n');
	}

	/** The SVG as draw.io's `getEmbeddedSvg` finishes it: its fonts and pictures inside, so an `<img>` or a canvas draws it whole. */
	function embed(svgRoot)
	{
		return new Promise(function(resolve)
		{
			editor.loadFonts(function()
			{
				var fonts = (editor.resolvedFontCss != null) ? usedFontCss(editor.resolvedFontCss, mxUtils.getXml(svgRoot)) : '';

				if (fonts != '')
				{
					editor.addFontCss(svgRoot, fonts);
				}

				editor.convertImages(svgRoot, resolve);
			});
		});
	}

	function toPng(svgRoot)
	{
		return new Promise(function(resolve, reject)
		{
			var img = new Image();

			img.onload = function()
			{
				var canvas = document.createElement('canvas');
				canvas.width = parseInt(svgRoot.getAttribute('width'));
				canvas.height = parseInt(svgRoot.getAttribute('height'));
				canvas.getContext('2d').drawImage(img, 0, 0);
				resolve(canvas.toDataURL('image/png'));
			};

			img.onerror = function()
			{
				reject(new Error('the picture could not be drawn'));
			};

			img.src = Editor.createSvgDataUri(mxUtils.getXml(svgRoot));
		});
	}

	function render(req)
	{
		// 🔒 YAZ-1802 D16: the app's dark-mode colour setting is draw.io's own default; a file's
		// `adaptiveColors` attribute (read by `setGraphXml`) still wins over it, as in the editor.
		Graph.defaultAdaptiveColors = req.adaptive;
		editor.setGraphXml(firstPage(req.xml));
		var bounds = graph.getGraphBounds();

		if (bounds.width <= 0 || bounds.height <= 0)
		{
			return Promise.resolve('');
		}

		var padding = req.padding;
		var scale = (req.maxWidth != null) ? Math.min(req.scale, (req.maxWidth - 2 * padding) / bounds.width,
			(req.maxHeight - 2 * padding) / bounds.height) : req.scale;

		if (req.format == 'png')
		{
			// A canvas has a size limit; a very large diagram comes out at the largest scale that fits it.
			scale = editor.getMaxCanvasScale(bounds.width + 2 * padding, bounds.height + 2 * padding, scale);
		}

		// A page with no background of its own gets draw.io's canvas colour, which its dark mode turns dark.
		var background = (graph.background != null && graph.background != mxConstants.NONE) ?
			graph.background : Editor.getDefaultPageBackgroundColor();
		var svgRoot = graph.getSvg(background, scale, padding, null, null, true, null, null, null,
			graph.shadowVisible, null, req.theme, 'diagram');

		if (graph.shadowVisible)
		{
			graph.addSvgShadow(svgRoot, null, null, padding == 0);
		}

		return embed(svgRoot).then(function(svgRoot)
		{
			return (req.format == 'png') ? toPng(svgRoot) : Editor.createSvgDataUri(mxUtils.getXml(svgRoot));
		});
	}

	function answer(reply)
	{
		window.parent.postMessage(JSON.stringify(reply), '*');
	}

	window.addEventListener('message', function(evt)
	{
		if (evt.source !== window.parent)
		{
			return;
		}

		var req = null;

		try
		{
			req = JSON.parse(evt.data);
		}
		catch (e)
		{
			return;
		}

		if (req == null || typeof req.id !== 'string' || typeof req.xml !== 'string')
		{
			return;
		}

		new Promise(function(resolve)
		{
			resolve(render(req));
		}).then(function(dataUrl)
		{
			answer({id: req.id, ok: true, dataUrl: dataUrl});
		}, function(e)
		{
			answer({id: req.id, ok: false, error: String(e && e.message || e)});
		});
	});

	// 🔒 YAZ-1802 D12a: the fonts the editor offers, from THIS origin, through draw.io's own `fontCss`
	// door — which is what `loadFonts` embeds. A sheet that will not load costs the fonts (labels fall
	// back to a system face), never the renderer.
	fetch('yaseen-fonts/fonts.css').then(function(res)
	{
		return res.ok ? res.text() : null;
	}).then(Editor.configureFontCss).catch(function(e)
	{
		console.error('Yaseen fonts', e);
	}).then(function()
	{
		answer({event: 'ready'});
	});
})();
