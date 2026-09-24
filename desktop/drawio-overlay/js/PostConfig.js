/**
 * Yaseen Draw's PostConfig (🔒 YAZ-1802 D12) — laid over draw.io's own stub by `tools/packDrawio.mjs`.
 * draw.io's `bootstrap.js` loads this right AFTER `app.min.js` whenever the page is not on a
 * draw.io domain. It is a config hook, not draw.io code: the first block is draw.io's stub
 * verbatim, everything below it is ours and only patches draw.io's public prototypes.
 *
 * ORDER IS GUARANTEED BY THE HOST, not by luck. The editor is built only after the host answers
 * draw.io's `configure` event (configure=1), and `DrawioEditor` answers it only once this file
 * has posted `{ event: 'yaseenReady' }` — so every prototype below is patched before the one
 * `EditorUi` exists.
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
	// 🔒 YAZ-1802 D12: plain wheel pans (draw.io's default with zoomWheel off), ctrl+wheel and a
	// trackpad pinch (Chromium sends it as ctrl+wheel) zoom — and so does ⌘+wheel, Excalidraw's gesture.
	var isZoomWheelEvent = Graph.prototype.isZoomWheelEvent;

	Graph.prototype.isZoomWheelEvent = function(evt)
	{
		return mxEvent.isMetaDown(evt) || isZoomWheelEvent.apply(this, arguments);
	};

	// 🔒 YAZ-1802 D12: every diagram opens with the shapes panel COLLAPSED — the canvas gets the
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

	// 📝 YAZ-1802 demo request 8: right-clicking EMPTY canvas offers draw.io's own Grid toggle (with
	// its check mark), beside the menu's zoom items. Wrapped last, so it lands at the end of the menu.
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

	// 🔒 YAZ-1802 D12: dragging a TEXT box by a corner scales its font, like Excalidraw; a side
	// handle only changes one dimension, so the text just re-wraps. A shape's own label never
	// scales (Excalidraw's doesn't either). The font change lands inside draw.io's resize
	// transaction, so the drag stays ONE undo step.
	function installTextScaling(graph)
	{
		var scaling = false;

		graph.addListener(mxEvent.CELLS_RESIZED, function(sender, evt)
		{
			var cells = evt.getProperty('cells');
			var previous = evt.getProperty('previous');

			if (scaling || cells == null || previous == null)
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

					if (before == null || geo == null || before.height <= 0 || !isTextCell(graph, cells[i]) ||
						geo.width == before.width || geo.height == before.height)
					{
						continue;
					}

					var size = parseFloat(styleOf(graph, cells[i])[mxConstants.STYLE_FONTSIZE]) || mxConstants.DEFAULT_FONTSIZE;
					graph.setCellStyles(mxConstants.STYLE_FONTSIZE, Math.max(1, Math.round(size * geo.height / before.height)), [cells[i]]);
				}
			}
			finally
			{
				scaling = false;
			}
		});
	}

	// ================================================================================
	// KEYMAP — Yasin's Excalidraw hotkeys, mapped onto draw.io (🔒 YAZ-1802 D12).
	// The TOOL letters that need no selection go through draw.io's own `keyboardShortcuts`
	// config (DrawioEditor's configure reply). The letters below BRANCH: with a selection they
	// colour it, without one they fall back to the tool in `TOOL_FALLBACK`. A colour letter no
	// longer starts typing into a selected shape's label (Enter / F2 still do; so does any other
	// letter).
	// ================================================================================

	/** Excalidraw's open-colour palette, [stroke shade, background shade]; `null` is transparent. */
	var COLOURS = {
		t: null,
		b: ['#1e1e1e', '#1e1e1e'],
		w: ['#ffffff', '#ffffff'],
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
	 * Which shade a letter FILLS a shape with: 0 = the stroke shade (the mapping as specified),
	 * 1 = the light background shade Excalidraw's own fill picker uses. One number to flip.
	 */
	var FILL_SHADE = 0;

	/** The tool a colour letter runs when nothing is selected (draw.io action names, verified in v31.5.2). */
	var TOOL_FALLBACK = {
		r: 'insertRectangle',
		o: 'insertEllipse',
		a: 'insertEdge',
		d: 'insertEdge',
		w: 'insertFreehand',
		p: 'insertFreehand',
		t: 'insertText'
	};

	/** 1…9, 0 with a selection: text font sizes, and the long side of a shape (aspect and centre kept). */
	var FONT_SIZES = [12, 16, 20, 24, 28, 36, 48, 64, 96, 128];
	var SHAPE_SIZES = [48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

	function styleOf(graph, cell)
	{
		return graph.getCellStyle(cell) || {};
	}

	/**
	 * A cell that IS text, whatever draw.io calls it: its own `text` shape, or — how AI-written and
	 * hand-styled diagrams usually spell a title — a labelled box with no fill and no border.
	 * Text-ness drives the colour key (font colour), 1–0 (font size) and corner-drag font scaling.
	 */
	function isTextCell(graph, cell)
	{
		var raw = graph.getModel().getStyle(cell) || '';
		var style = styleOf(graph, cell);

		if (/^text(;|$)/.test(raw) || style[mxConstants.STYLE_SHAPE] == 'text')
		{
			return true;
		}

		return graph.getModel().isVertex(cell) && !isImageCell(graph, cell) && graph.getModel().getChildCount(cell) == 0 &&
			graph.convertValueToString(cell) != '' &&
			(style[mxConstants.STYLE_FILLCOLOR] == null || style[mxConstants.STYLE_FILLCOLOR] == 'none') &&
			(style[mxConstants.STYLE_STROKECOLOR] == null || style[mxConstants.STYLE_STROKECOLOR] == 'none');
	}

	function isImageCell(graph, cell)
	{
		var style = styleOf(graph, cell);

		return style[mxConstants.STYLE_SHAPE] == 'image' || style[mxConstants.STYLE_IMAGE] != null;
	}

	/** Which style key a colour lands on for this cell (see the keymap note above). */
	function colourKey(graph, cell, shift)
	{
		var model = graph.getModel();

		if (model.isEdge(cell) || isImageCell(graph, cell))
		{
			return mxConstants.STYLE_STROKECOLOR;
		}
		else if (isTextCell(graph, cell))
		{
			return mxConstants.STYLE_FONTCOLOR;
		}
		else if (shift || styleOf(graph, cell)[mxConstants.STYLE_FILLCOLOR] == 'none')
		{
			// Shift+letter strokes a shape; a stroke-only shape (freehand) has nothing to fill.
			return mxConstants.STYLE_STROKECOLOR;
		}

		return mxConstants.STYLE_FILLCOLOR;
	}

	function applyColour(ui, letter, shift)
	{
		var graph = ui.editor.graph;
		var cells = graph.getSelectionCells();
		var entry = COLOURS[letter];
		var byKey = {};

		for (var i = 0; i < cells.length; i++)
		{
			var key = colourKey(graph, cells[i], shift);
			(byKey[key] = byKey[key] || []).push(cells[i]);
		}

		graph.getModel().beginUpdate();

		try
		{
			for (var key in byKey)
			{
				var value = (entry == null) ? 'none' : entry[(key == mxConstants.STYLE_FILLCOLOR) ? FILL_SHADE : 0];
				graph.setCellStyles(key, value, byKey[key]);
			}
		}
		finally
		{
			graph.getModel().endUpdate();
		}
	}

	function applySize(ui, index)
	{
		var graph = ui.editor.graph;
		var model = graph.getModel();
		var cells = graph.getSelectionCells();
		var texts = [];

		model.beginUpdate();

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				var cell = cells[i];

				if (isTextCell(graph, cell))
				{
					texts.push(cell);
				}
				else if (model.isVertex(cell))
				{
					var geo = model.getGeometry(cell);

					if (geo != null && !geo.relative && geo.width > 0 && geo.height > 0)
					{
						geo = geo.clone();
						var k = SHAPE_SIZES[index] / Math.max(geo.width, geo.height);
						var cx = geo.x + geo.width / 2;
						var cy = geo.y + geo.height / 2;
						geo.width = Math.round(geo.width * k);
						geo.height = Math.round(geo.height * k);
						geo.x = Math.round(cx - geo.width / 2);
						geo.y = Math.round(cy - geo.height / 2);
						model.setGeometry(cell, geo);
					}
				}
			}

			if (texts.length > 0)
			{
				graph.setCellStyles(mxConstants.STYLE_FONTSIZE, FONT_SIZES[index], texts);
				graph.updateCellSize && texts.forEach(function(cell) { graph.updateCellSize(cell, true); });
			}
		}
		finally
		{
			model.endUpdate();
		}
	}

	function runAction(ui, name)
	{
		var action = ui.actions.get(name);

		if (action != null && action.isEnabled())
		{
			action.funct();
		}
	}

	/**
	 * Installed after draw.io's own bindings AND the config's `keyboardShortcuts`, so these win.
	 *
	 * A bare letter WITH a selection never reaches a binding in draw.io: its key handler returns
	 * null for A–Z while cells are selected, on purpose, so typing starts editing the label. The
	 * colour letters therefore sit in front of that rule, in this instance's `getFunction`; with
	 * nothing selected they fall through to the ordinary binding (the tool, or nothing).
	 */
	function installYaseenKeymap(ui)
	{
		var graph = ui.editor.graph;
		var keys = ui.keyHandler;
		var withSelection = {};

		Object.keys(COLOURS).forEach(function(letter)
		{
			var code = letter.toUpperCase().charCodeAt(0);

			withSelection[code] = function()
			{
				applyColour(ui, letter, false);
			};

			if (TOOL_FALLBACK[letter] != null)
			{
				keys.bindKey(code, function()
				{
					runAction(ui, TOOL_FALLBACK[letter]);
				});
			}
			else
			{
				// A colour letter with no tool of its own does nothing without a selection
				// (draw.io's C would otherwise still insert an edge).
				delete keys.normalKeys[code];
			}

			keys.bindShiftKey(code, function()
			{
				if (!graph.isSelectionEmpty())
				{
					applyColour(ui, letter, true);
				}
			});
		});

		var getFunction = keys.getFunction;

		keys.getFunction = function(evt)
		{
			if (evt != null && withSelection[evt.keyCode] != null && !graph.isSelectionEmpty() &&
				!mxEvent.isAltDown(evt) && !mxEvent.isShiftDown(evt) && !this.isControlDown(evt))
			{
				return withSelection[evt.keyCode];
			}

			return getFunction.apply(this, arguments);
		};

		// 1–9, 0 (key codes 49…57, then 48) size the selection.
		for (var i = 0; i < 10; i++)
		{
			(function(index)
			{
				keys.bindKey(index == 9 ? 48 : 49 + index, function()
				{
					if (!graph.isSelectionEmpty())
					{
						applySize(ui, index);
					}
				});
			})(i);
		}

		// ⌘⇧X toggles strikethrough (fontStyle bit 8) on the selection.
		keys.bindControlShiftKey(88, function()
		{
			if (!graph.isSelectionEmpty())
			{
				graph.toggleCellStyleFlags(mxConstants.STYLE_FONTSTYLE, mxConstants.FONT_STRIKETHROUGH, graph.getSelectionCells());
			}
		});
	}

	var installKeyboardShortcuts = EditorUi.prototype.installKeyboardShortcuts;

	EditorUi.prototype.installKeyboardShortcuts = function()
	{
		installKeyboardShortcuts.apply(this, arguments);

		try
		{
			installYaseenKeymap(this);
		}
		catch (e)
		{
			if (window.console != null)
			{
				console.error('Yaseen keymap', e);
			}
		}
	};

	// 🔒 YAZ-1802 D12: the fonts the editor offers first are files on THIS origin
	// (`yaseen-fonts/`, copied from the Excalidraw package by packDrawio) — never Google Fonts.
	// Their @font-face sheet goes through draw.io's own `fontCss` door, which also admits the
	// URLs for export; read here so the host never has to know the file names.
	function loadFonts()
	{
		return fetch('yaseen-fonts/fonts.css').then(function(res)
		{
			return res.ok ? res.text() : '';
		}).then(function(css)
		{
			if (css != '')
			{
				Editor.configureFontCss(css);
			}
		})['catch'](function(e)
		{
			if (window.console != null)
			{
				console.error('Yaseen fonts', e);
			}
		});
	}

	// The handshake (see the header): everything above is in place, the host may configure now.
	loadFonts().then(function()
	{
		if (window.parent != null && window.parent != window)
		{
			window.parent.postMessage(JSON.stringify({event: 'yaseenReady'}), '*');
		}
	});
})();
