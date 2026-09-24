/**
 * The diagram PICTURE service (🔒 YAZ-1802 D9): one hidden iframe in the renderer loads
 * `yaseen-render.html`, posts `{ id, xml, theme, maxWidth, maxHeight, padding }` and gets back
 * `{ id, ok: true, dataUrl }` — an SVG data URL of the diagram's FIRST page, drawn by draw.io's own
 * viewer (`viewer-static.min.js`) — or `{ id, ok: false, error }`. `dataUrl` is `''` for a page
 * with nothing on it. SVG rather than PNG on purpose: draw.io's HTML labels are `foreignObject`,
 * which taints a canvas, so a PNG could not be read back out of it.
 *
 * Messages are JSON strings (draw.io's own `proto=json` convention) and are accepted only from
 * the parent frame; the answer goes back to the parent alone.
 */
(function()
{
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

	function render(req)
	{
		var container = document.createElement('div');
		container.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;';
		document.body.appendChild(container);
		var graph = null;

		try
		{
			graph = new Graph(container);
			var node = firstPage(req.xml);
			new mxCodec(node.ownerDocument).decode(node, graph.getModel());
			var bounds = graph.getGraphBounds();

			if (bounds.width <= 0 || bounds.height <= 0)
			{
				return '';
			}

			var padding = req.padding || 16;
			var scale = Math.min(1, (req.maxWidth - 2 * padding) / bounds.width, (req.maxHeight - 2 * padding) / bounds.height);
			var background = node.getAttribute('background');
			background = (background != null && background != '' && background != 'none') ? background : '#ffffff';
			var svg = graph.getSvg(background, scale, padding, false, null, true, null, null, null, null, null, req.theme == 'dark' ? 'dark' : 'light');

			return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(mxUtils.getXml(svg))));
		}
		finally
		{
			if (graph != null)
			{
				graph.destroy();
			}

			container.parentNode.removeChild(container);
		}
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

		var reply;

		try
		{
			reply = {id: req.id, ok: true, dataUrl: render(req)};
		}
		catch (e)
		{
			reply = {id: req.id, ok: false, error: String(e && e.message || e)};
		}

		window.parent.postMessage(JSON.stringify(reply), '*');
	});

	window.parent.postMessage(JSON.stringify({event: 'ready'}), '*');
})();
