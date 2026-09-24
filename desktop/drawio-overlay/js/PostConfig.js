/**
 * Yaseen Draw's PostConfig (🔒 YAZ-1802 D12a / D12b) — laid over draw.io's own stub by `tools/packDrawio.mjs`.
 * draw.io's `bootstrap.js` loads this right AFTER `app.min.js` whenever the page is not on a
 * draw.io domain. It is a config hook, not draw.io code: the first block is draw.io's stub
 * verbatim, everything below it is ours and only patches draw.io's public prototypes.
 *
 * ORDER IS GUARANTEED BY THE HOST, not by luck. The editor is built only after the host answers
 * draw.io's `configure` event (configure=1), and `DrawioEditor` answers it only once this file
 * has posted `{ event: 'yaseenReady' }` — so every prototype below is patched before the one
 * `EditorUi` exists. `tools/drawioOverlay.test.mjs` runs this file against a stand-in draw.io.
 *
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

// ---- Yaseen Draw ----
(function()
{
	// 🔒 YAZ-1802 D12a: plain wheel pans (draw.io's default with zoomWheel off), ctrl+wheel and a
	// trackpad pinch (Chromium sends it as ctrl+wheel) zoom — and so does ⌘+wheel, Excalidraw's gesture.
	var isZoomWheelEvent = Graph.prototype.isZoomWheelEvent;

	Graph.prototype.isZoomWheelEvent = function(evt)
	{
		return mxEvent.isMetaDown(evt) || isZoomWheelEvent.apply(this, arguments);
	};

	// 🔒 YAZ-1802 D12a: every diagram opens with the shapes panel COLLAPSED — the canvas gets the
	// room, and the toolbar's shapes button reopens the panel at draw.io's default width. Without
	// this, draw.io restores the last width it saved (`mxSettings`) or its own open default.
	mxSettings.getSidebarWidth = function()
	{
		return null;
	};

	var createUi = EditorUi.prototype.createUi;

	EditorUi.prototype.createUi = function()
	{
		this.hsplitPosition = 0;
		createUi.apply(this, arguments);
		installTextScaling(this.editor.graph);
	};

	// 🔒 YAZ-1802 D12a: right-clicking EMPTY canvas offers draw.io's own Grid toggle (with its check
	// mark), beside the menu's zoom items. Wrapped last, so it lands at the end of the menu.
	var createPopupMenu = Menus.prototype.createPopupMenu;

	Menus.prototype.createPopupMenu = function(menu, cell, evt)
	{
		createPopupMenu.apply(this, arguments);

		if (this.editorUi.editor.graph.isSelectionEmpty())
		{
			menu.addSeparator();
			this.addMenuItems(menu, ['grid'], null, evt);
		}
	};

	// 🔒 YAZ-1802 D12a: dragging a TEXT box by a corner scales its font, like Excalidraw; a side
	// handle only changes one dimension, so the text just re-wraps. A shape's own label never
	// scales (Excalidraw's doesn't either). The font change lands inside draw.io's resize
	// transaction, so the drag stays ONE undo step; the guard keeps that change from re-entering.
	function installTextScaling(graph)
	{
		var scaling = false;

		graph.addListener(mxEvent.CELLS_RESIZED, function(sender, evt)
		{
			var cells = evt.getProperty('cells');
			var previous = evt.getProperty('previous');

			if (scaling)
			{
				return;
			}

			scaling = true;

			try
			{
				for (var i = 0; i < cells.length; i++)
				{
					var before = previous[i];
					var geo = graph.getModel().getGeometry(cells[i]);

					if (before.height > 0 && geo.width != before.width && geo.height != before.height &&
						cellKind(graph, cells[i]) == 'text')
					{
						var size = parseFloat(graph.getCellStyle(cells[i])[mxConstants.STYLE_FONTSIZE]) || mxConstants.DEFAULT_FONTSIZE;
						graph.setCellStyles(mxConstants.STYLE_FONTSIZE, Math.max(1, Math.round(size * geo.height / before.height)), [cells[i]]);
					}
				}
			}
			finally
			{
				scaling = false;
			}
		});
	}

	// ================================================================================
	// KEYMAP — Yasin's Excalidraw keys on draw.io (🔒 YAZ-1802 D12b).
	// With NOTHING selected a bare letter is a tool: those bindings are draw.io's own, set by the
	// host's configure reply (`keyboardShortcuts` in drawioProtocol.ts). Everything that acts on a
	// selection is here — colour letters, Shift+colour, 1–0 — plus ⌘⇧X and ⌘B's split. A colour
	// letter no longer starts typing into a selected shape's label; Enter / F2 still do.
	// ================================================================================

	/**
	 * The Excalidraw fork's colour letters (`SEMANTIC_COLOR_HOTKEYS`) over its open-colour palette,
	 * as [stroke shade, background shade] — palette index 4 and 1, the fork's
	 * `DEFAULT_ELEMENT_STROKE_COLOR_INDEX` / `DEFAULT_ELEMENT_BACKGROUND_COLOR_INDEX`. Transparent,
	 * black and white are one value for both.
	 */
	var COLOURS = {
		t: 'none',
		b: '#1e1e1e',
		w: '#ffffff',
		d: ['#343a40', '#e9ecef'],
		r: ['#e03131', '#ffc9c9'],
		p: ['#c2255c', '#fcc2d7'],
		a: ['#9c36b5', '#eebefa'],
		v: ['#6741d9', '#d0bfff'],
		u: ['#1971c2', '#a5d8ff'],
		c: ['#0c8599', '#99e9f2'],
		e: ['#099268', '#96f2d7'],
		g: ['#2f9e44', '#b2f2bb'],
		y: ['#f08c00', '#ffec99'],
		o: ['#e8590c', '#ffd8a8'],
		n: ['#846358', '#eaddd7']
	};

	/**
	 * The style key a colour letter sets, by what the cell is (`cellKind`), as [letter, Shift+letter]
	 * — the fork's rule: a shape fills (Shift strokes it), text takes the font colour (Shift its
	 * background), a line or a freehand stroke takes the stroke, and an image its border.
	 */
	var COLOUR_KEYS = {
		shape: [mxConstants.STYLE_FILLCOLOR, mxConstants.STYLE_STROKECOLOR],
		text: [mxConstants.STYLE_FONTCOLOR, mxConstants.STYLE_LABEL_BACKGROUNDCOLOR],
		line: [mxConstants.STYLE_STROKECOLOR, mxConstants.STYLE_STROKECOLOR],
		image: [mxConstants.STYLE_IMAGE_BORDER, mxConstants.STYLE_IMAGE_BORDER]
	};

	/** 1…9, 0 with a selection: a text's font size, or the long side of anything else (aspect and centre kept). */
	var SIZE_KEYS = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48];
	var FONT_SIZES = [12, 16, 20, 24, 28, 36, 48, 64, 96, 128];
	var SHAPE_SIZES = [48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

	/**
	 * What a cell is to the keymap and to text scaling: 'line' (an edge, or draw.io's freehand pen —
	 * an inline stencil drawn in its stroke colour, `lineShape=1` by default, `fillColor=none` in
	 * the classic pen), 'image', 'text' or 'shape'.
	 *
	 * "Text" means LOOKS like text (🔒 YAZ-1802 D12a): draw.io's own text style, or — how AI-written
	 * and hand-styled diagrams spell a title — a childless, labelled vertex with no fill and no border.
	 */
	function cellKind(graph, cell)
	{
		var model = graph.getModel();
		var style = graph.getCellStyle(cell);
		var shape = String(style[mxConstants.STYLE_SHAPE]);

		if (model.isEdge(cell) || (shape.indexOf('stencil(') == 0 &&
			(style.lineShape == '1' || style[mxConstants.STYLE_FILLCOLOR] == mxConstants.NONE)))
		{
			return 'line';
		}
		else if (shape == 'image')
		{
			return 'image';
		}
		else if (/^text(;|$)/.test(model.getStyle(cell) || '') || (model.getChildCount(cell) == 0 &&
			graph.convertValueToString(cell) != '' && isUnset(style[mxConstants.STYLE_FILLCOLOR]) &&
			isUnset(style[mxConstants.STYLE_STROKECOLOR])))
		{
			return 'text';
		}

		return 'shape';
	}

	function isUnset(colour)
	{
		return colour == null || colour == mxConstants.NONE;
	}

	/** A letter's colour for one style key: backgrounds take the light shade, strokes and text the dark one. */
	function colourValue(letter, key)
	{
		var entry = COLOURS[letter];

		if (typeof entry == 'string')
		{
			return entry;
		}

		return (key == mxConstants.STYLE_FILLCOLOR || key == mxConstants.STYLE_LABEL_BACKGROUNDCOLOR) ? entry[1] : entry[0];
	}

	// Both act on the EDITABLE selection, as draw.io's own style controls do: a locked cell keeps its look.
	function applyColour(graph, letter, shift)
	{
		var model = graph.getModel();
		var cells = graph.getEditableCells(graph.getSelectionCells());

		model.beginUpdate();

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				var key = COLOUR_KEYS[cellKind(graph, cells[i])][shift ? 1 : 0];
				graph.setCellStyles(key, colourValue(letter, key), [cells[i]]);
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	function applySize(graph, index)
	{
		var model = graph.getModel();
		var cells = graph.getEditableCells(graph.getSelectionCells());

		model.beginUpdate();

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				var geo = model.getGeometry(cells[i]);

				if (cellKind(graph, cells[i]) == 'text')
				{
					graph.setCellStyles(mxConstants.STYLE_FONTSIZE, FONT_SIZES[index], [cells[i]]);
					graph.updateCellSize(cells[i], true);
				}
				// An edge's label is a relative vertex, and a zero-size vertex has no long side to scale.
				else if (model.isVertex(cells[i]) && !geo.relative && geo.width > 0 && geo.height > 0)
				{
					model.setGeometry(cells[i], fitLongSide(geo, SHAPE_SIZES[index]));
				}
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	/** `geo` scaled about its centre until its long side is `side`. */
	function fitLongSide(geo, side)
	{
		var fitted = geo.clone();
		var k = side / Math.max(geo.width, geo.height);
		fitted.width = Math.round(geo.width * k);
		fitted.height = Math.round(geo.height * k);
		fitted.x = Math.round(geo.x + (geo.width - fitted.width) / 2);
		fitted.y = Math.round(geo.y + (geo.height - fitted.height) / 2);

		return fitted;
	}

	/**
	 * Installed after draw.io's own bindings AND the configure reply's, so these win.
	 *
	 * draw.io's key handler returns null for a bare A–Z while cells are selected, on purpose, so
	 * typing starts editing the label. The selection keys therefore sit in FRONT of that rule, in
	 * this instance's `getFunction`; with nothing selected every key falls through to draw.io.
	 */
	function installKeymap(ui)
	{
		var graph = ui.editor.graph;
		var keys = ui.keyHandler;
		var getFunction = keys.getFunction;

		keys.getFunction = function(evt)
		{
			if (!graph.isSelectionEmpty() && !this.isControlDown(evt) && !mxEvent.isAltDown(evt))
			{
				var letter = String.fromCharCode(evt.keyCode).toLowerCase();
				var shift = mxEvent.isShiftDown(evt);
				var size = SIZE_KEYS.indexOf(evt.keyCode);

				if (COLOURS[letter] != null)
				{
					return function()
					{
						applyColour(graph, letter, shift);
					};
				}
				else if (size >= 0 && !shift)
				{
					return function()
					{
						applySize(graph, size);
					};
				}
			}

			return getFunction.apply(this, arguments);
		};

		// ⌘⇧X toggles strikethrough (fontStyle bit 8); given no cells, draw.io takes the editable selection.
		keys.bindControlShiftKey(88, function()
		{
			graph.toggleCellStyleFlags(mxConstants.STYLE_FONTSTYLE, mxConstants.FONT_STRIKETHROUGH);
		});

		// ⌘B is draw.io's bold on a selection. With nothing selected it is the app's sidebar toggle
		// (the default decided on YAZ-1948), which the host page owns — and a key pressed in this
		// frame never reaches that page, so it is passed up as draw.io's own `shortcut` event (what
		// its `passThroughKeys` config sends, which cannot ask about the selection).
		var bold = keys.controlKeys[66];

		keys.bindControlKey(66, function()
		{
			if (graph.isSelectionEmpty())
			{
				postToHost({event: 'shortcut', command: 'toggleSidebar'});
			}
			else
			{
				bold.apply(this, arguments);
			}
		});
	}

	var installKeyboardShortcuts = EditorUi.prototype.installKeyboardShortcuts;

	EditorUi.prototype.installKeyboardShortcuts = function()
	{
		installKeyboardShortcuts.apply(this, arguments);
		installKeymap(this);
	};

	/**
	 * A message to the host page, a JSON string like every embed message. Posted to any origin
	 * because the host's differs between dev (the Vite server) and a packaged app; nothing in it is
	 * private — draw.io posts the diagram itself the same way.
	 */
	function postToHost(msg)
	{
		window.parent.postMessage(JSON.stringify(msg), '*');
	}

	// 🔒 YAZ-1802 D12a: the fonts the editor offers first are files on THIS origin
	// (`yaseen-fonts/`, copied from the Excalidraw package by packDrawio) — never Google Fonts.
	// Their @font-face sheet goes through draw.io's own `fontCss` door, which also admits the URLs
	// for export; read here so the host never has to know the file names. A sheet that will not
	// load costs the fonts, never the handshake below.
	function loadFonts()
	{
		return fetch('yaseen-fonts/fonts.css').then(function(res)
		{
			return res.ok ? res.text() : null;
		}).then(Editor.configureFontCss).catch(function(e)
		{
			console.error('Yaseen fonts', e);
		});
	}

	// The handshake (see the header): everything above is in place, the host may configure now.
	loadFonts().then(function()
	{
		postToHost({event: 'yaseenReady'});
	});
})();
