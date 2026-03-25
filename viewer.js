let DATA = null;
let VIEWER = null;

const params = new URLSearchParams(window.location.search);
const volumeId = params.get("volume");
const treeId = params.get("tree");

fetch("data/volumes.json")
  .then((res) => res.json())
  .then((data) => {
    DATA = data;
    return renderSelectedTree();
  })
  .catch((err) => {
    document.getElementById("treeView").textContent = "Failed to load data.";
    console.error(err);
  });

async function renderSelectedTree() {
  const volume = DATA.volumes.find((entry) => entry.id === volumeId);
  if (!volume) {
    document.getElementById("treeView").textContent = "Volume not found.";
    return;
  }

  const treeMeta = volume.trees.find((entry) => entry.id === treeId);
  if (!treeMeta) {
    document.getElementById("treeView").textContent = "Tree not found.";
    return;
  }

  const response = await fetch(treeMeta.file);
  const treeData = await response.json();

  document.getElementById("treeTitle").textContent = treeMeta.name || treeData.name || treeId;

  if (VIEWER) {
    VIEWER.destroy();
  }

  const normalizedTree = normalizeTree(treeMeta, treeData);
  VIEWER = createCanvasViewer(normalizedTree);
  renderSources(normalizedTree);
}

function normalizeTree(treeMeta, treeData) {
  const sourcePeople = Array.isArray(treeData.people)
    ? treeData.people
    : Object.entries(treeData.people || {}).map(([id, person]) => ({ id, ...person }));

  const people = {};

  sourcePeople.forEach((person) => {
    people[person.id] = {
      id: person.id,
      lines: normalizeLines(person),
      link: normalizePersonLink(person),
      wrap: normalizeWrapSetting(person.wrap, treeData.wrap),
      wrapWidth: normalizeWrapWidth(person.wrapWidth, treeData.wrapWidth),
      parents: normalizeParents(person),
      children: normalizeChildren(person)
    };
  });

  inferParentLinksFromChildren(people);

  const chartPersonIds = Object.keys(people);
  const primaryParentByChild = buildPrimaryParentMap(people, chartPersonIds);
  const childrenByParent = buildChildrenMap(primaryParentByChild, people);
  const childMarkersByParent = buildChildMarkersMap(people);
  const generationLevels = buildGenerationLevels(chartPersonIds, primaryParentByChild);
  const roots = chartPersonIds.filter((personId) => !primaryParentByChild.get(personId));

  return {
    id: treeMeta.id,
    name: treeMeta.name || treeData.name || treeMeta.id,
    roots,
    people,
    sources: normalizeSources(treeData.sources),
    chartPersonIds,
    childrenByParent,
    childMarkersByParent,
    generationLevels
  };
}

function normalizeWrapSetting(personValue, treeValue) {
  if (typeof personValue === "boolean") {
    return personValue;
  }

  return Boolean(treeValue);
}

function normalizeWrapWidth(personValue, treeValue) {
  const width = Number(personValue ?? treeValue);
  return Number.isFinite(width) && width > 40 ? width : 220;
}

function normalizePersonLink(person) {
  const source = person.link || person.treeLink || person.nextTree || null;
  if (!source) {
    return null;
  }

  if (typeof source === "string") {
    return {
      href: source
    };
  }

  const nextVolume = source.volume || source.volumeId || volumeId || "";
  const nextTree = source.tree || source.treeId || source.id || "";
  if (!nextTree) {
    return source.href ? { href: source.href } : null;
  }

  return {
    href: source.href || `viewer.html?volume=${encodeURIComponent(nextVolume)}&tree=${encodeURIComponent(nextTree)}`
  };
}

function normalizeLines(person) {
  if (Array.isArray(person.lines) && person.lines.length) {
    return person.lines
      .map(normalizeLine)
      .filter((line) => line && line.text);
  }

  if (typeof person.text === "string" && person.text.trim()) {
    return person.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeLine(line));
  }

  if (typeof person.name === "string" && person.name.trim()) {
    return [normalizeLine(person.name.trim())];
  }

  return [normalizeLine(person.id)];
}

function normalizeLine(line) {
  if (typeof line === "string") {
    const parts = parseInlineLineParts(line);
    return {
      text: line,
      parts,
      underline: false
    };
  }

  if (!line || typeof line !== "object") {
    return null;
  }

  if (Array.isArray(line.parts) && line.parts.length) {
    const parts = line.parts
      .map((part) => {
        if (typeof part === "string") {
          return { text: part, underline: false, bold: false };
        }

        if (!part || typeof part !== "object") {
          return null;
        }

        const partText = part.text || part.value || "";
        return partText
          ? {
              text: String(partText),
              underline: Boolean(part.underline),
              bold: Boolean(part.bold)
            }
          : null;
      })
      .filter((part) => part && part.text);

    if (!parts.length) {
      return null;
    }

    return {
      text: parts.map((part) => part.text).join(""),
      parts,
      underline: false
    };
  }

  const text = line.text || line.value || line.line || "";
  return text
    ? {
        text: String(text),
        parts: line.underline
          ? [{ text: String(text), underline: true, bold: false }]
          : parseInlineLineParts(String(text)),
        underline: Boolean(line.underline)
      }
    : null;
}

function parseInlineLineParts(text) {
  const parts = [];
  const pattern = /(\*\*.+?\*\*|__.+?__)/g;
  let lastIndex = 0;
  let match = null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        underline: false,
        bold: false
      });
    }

    parts.push({
      text: match[0].slice(2, -2),
      underline: match[0].startsWith("__"),
      bold: match[0].startsWith("**")
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      underline: false,
      bold: false
    });
  }

  return parts.length
    ? parts
    : [{
        text,
        underline: false,
        bold: false
      }];
}

function normalizeParents(person) {
  if (Array.isArray(person.parents)) {
    return person.parents.filter(Boolean);
  }

  if (person.parents && typeof person.parents === "object") {
    return [person.parents.father, person.parents.mother].filter(Boolean);
  }

  return [person.father, person.mother].filter(Boolean);
}

function normalizeChildren(person) {
  if (!Array.isArray(person.children)) {
    return [];
  }

  return person.children.flatMap((child) => normalizeChildEntry(child));
}

function normalizeChildEntry(child) {
  if (typeof child === "string") {
    return [{ id: child, marker: "" }];
  }

  if (!child || typeof child !== "object") {
    return [];
  }

  const marker = normalizeChildMarker(
    child.marker || child.wife || child.wifeIndex || child.marriage || child.origin
  );

  const groupedIds = Array.isArray(child.children)
    ? child.children
    : Array.isArray(child.ids)
      ? child.ids
      : Array.isArray(child.people)
        ? child.people
        : null;

  if (groupedIds) {
    return groupedIds
      .filter(Boolean)
      .map((childId) => ({
        id: String(childId),
        marker
      }));
  }

  const id = child.id || child.personId || child.childId || "";
  return id
    ? [{
        id,
        marker
      }]
    : [];
}

function normalizeChildMarker(value) {
  if (value == null || value === "") {
    return "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  return text.startsWith("(") ? text : `(${text})`;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    return typeof sources === "string" && sources.trim()
      ? [{ text: sources.trim(), note: "" }]
      : [];
  }

  return sources
    .map((source) => {
      if (typeof source === "string") {
        return { text: source, note: "" };
      }

      return {
        text: source?.text || source?.citation || source?.source || "",
        note: source?.note || ""
      };
    })
    .filter((source) => source.text);
}

function inferParentLinksFromChildren(people) {
  Object.values(people).forEach((person) => {
    person.children.forEach((childRef) => {
      const child = people[childRef.id];
      if (!child) {
        return;
      }

      if (!child.parents.includes(person.id)) {
        child.parents.push(person.id);
      }
    });
  });
}

function buildPrimaryParentMap(people, chartPersonIds) {
  const chartSet = new Set(chartPersonIds);
  const primaryParentByChild = new Map();

  chartPersonIds.forEach((personId) => {
    const person = people[personId];
    const chartParents = person.parents.filter((parentId) => chartSet.has(parentId));

    if (chartParents.length) {
      primaryParentByChild.set(personId, chartParents[0]);
    }
  });

  return primaryParentByChild;
}

function buildChildrenMap(primaryParentByChild, people) {
  const childrenByParent = new Map();

  Object.values(people).forEach((person) => {
    if (!childrenByParent.has(person.id)) {
      childrenByParent.set(person.id, []);
    }

    person.children.forEach((childRef) => {
      if (primaryParentByChild.get(childRef.id) === person.id) {
        childrenByParent.get(person.id).push(childRef.id);
      }
    });
  });

  primaryParentByChild.forEach((parentId, childId) => {
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }

    if (!childrenByParent.get(parentId).includes(childId)) {
      childrenByParent.get(parentId).push(childId);
    }
  });

  return childrenByParent;
}

function buildChildMarkersMap(people) {
  const childMarkersByParent = new Map();

  Object.values(people).forEach((person) => {
    const markers = new Map();
    person.children.forEach((childRef) => {
      if (childRef.marker) {
        markers.set(childRef.id, childRef.marker);
      }
    });

    childMarkersByParent.set(person.id, markers);
  });

  return childMarkersByParent;
}

function buildGenerationLevels(chartPersonIds, primaryParentByChild) {
  const levels = {};

  const visit = (personId) => {
    if (typeof levels[personId] === "number") {
      return levels[personId];
    }

    const parentId = primaryParentByChild.get(personId);
    levels[personId] = parentId ? visit(parentId) + 1 : 0;
    return levels[personId];
  };

  chartPersonIds.forEach(visit);
  return levels;
}

function createCanvasViewer(tree) {
  const host = document.getElementById("treeView");
  const canvas = document.getElementById("treeCanvas");
  const textLayer = document.getElementById("treeTextLayer");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const state = {
    tree,
    canvas,
    textLayer,
    ctx,
    dpr,
    viewport: {
      scale: 1,
      offsetX: 0,
      offsetY: 0
    },
    geometry: null,
    dragging: false,
    lastPointer: null
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    state.geometry = computeLayout(tree, ctx);
    fitToViewport(state);
    drawTree(state);
  };

  const onPointerDown = (event) => {
    state.dragging = true;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!state.dragging || !state.lastPointer) {
      return;
    }

    state.viewport.offsetX += event.clientX - state.lastPointer.x;
    state.viewport.offsetY += event.clientY - state.lastPointer.y;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    drawTree(state);
  };

  const onPointerUp = (event) => {
    state.dragging = false;
    state.lastPointer = null;
    canvas.releasePointerCapture(event.pointerId);
  };

  const onTextLayerClick = (event) => {
    const box = event.target.closest(".tree-text-box.is-linked");
    if (!box) {
      return;
    }

    const selection = window.getSelection();
    if (selection && String(selection).trim()) {
      return;
    }

    const href = box.dataset.href;
    if (href) {
      window.location.href = href;
    }
  };

  const onWheel = (event) => {
    event.preventDefault();

    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.9;
    const oldScale = state.viewport.scale;
    const newScale = clamp(oldScale * zoomFactor, 0.25, 3.5);
    const worldX = (event.offsetX - state.viewport.offsetX) / oldScale;
    const worldY = (event.offsetY - state.viewport.offsetY) / oldScale;

    state.viewport.scale = newScale;
    state.viewport.offsetX = event.offsetX - worldX * newScale;
    state.viewport.offsetY = event.offsetY - worldY * newScale;
    drawTree(state);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  textLayer.addEventListener("click", onTextLayerClick);

  document.getElementById("zoomInBtn").onclick = () => zoomBy(state, 1.15);
  document.getElementById("zoomOutBtn").onclick = () => zoomBy(state, 0.87);
  document.getElementById("zoomResetBtn").onclick = () => {
    fitToViewport(state);
    drawTree(state);
  };

  window.addEventListener("resize", resize);
  resize();

  return {
    destroy() {
      textLayer.innerHTML = "";
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      textLayer.removeEventListener("click", onTextLayerClick);
      window.removeEventListener("resize", resize);
    }
  };
}

function computeLayout(tree, ctx) {
  const personBoxes = new Map();
  const boxGap = 28;
  const levelMarginTop = 60;
  const levelPadding = 70;

  tree.chartPersonIds.forEach((personId) => {
    const person = tree.people[personId];
    const size = measurePersonBox(person, ctx);
    personBoxes.set(personId, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      person,
      displayLines: size.displayLines
    });
  });

  const generationHeights = {};
  tree.chartPersonIds.forEach((personId) => {
    const level = tree.generationLevels[personId] || 0;
    const box = personBoxes.get(personId);
    generationHeights[level] = Math.max(generationHeights[level] || 0, box.height);
  });

  const generationTops = {};
  const sortedLevels = [...new Set(Object.values(tree.generationLevels))].sort((left, right) => left - right);
  let currentTop = levelMarginTop;
  sortedLevels.forEach((level) => {
    generationTops[level] = currentTop;
    currentTop += (generationHeights[level] || 0) + levelPadding;
  });
  const subtreeBounds = new Map();
  let nextLeafLeft = 0;

  const layoutNode = (personId) => {
    const box = personBoxes.get(personId);
    const level = tree.generationLevels[personId] || 0;
    box.y = generationTops[level];

    const childIds = tree.childrenByParent.get(personId) || [];
    if (!childIds.length) {
      box.x = nextLeafLeft;
      const bounds = {
        left: box.x,
        right: box.x + box.width
      };
      subtreeBounds.set(personId, bounds);
      nextLeafLeft = bounds.right + boxGap;
      return bounds;
    }

    let firstCenter = null;
    let lastCenter = null;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;

    childIds.forEach((childId) => {
      const childBounds = layoutNode(childId);
      const childBox = personBoxes.get(childId);
      const childCenter = childBox.x + childBox.width / 2;
      if (firstCenter == null) {
        firstCenter = childCenter;
      }
      lastCenter = childCenter;
      left = Math.min(left, childBounds.left);
      right = Math.max(right, childBounds.right);
    });

    const desiredCenter = (firstCenter + lastCenter) / 2;
    box.x = desiredCenter - box.width / 2;

    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);

    const bounds = { left, right };
    subtreeBounds.set(personId, bounds);
    return bounds;
  };

  tree.roots.forEach((rootId, index) => {
    if (index) {
      nextLeafLeft += 48;
    }
    layoutNode(rootId);
  });

  const shiftSubtree = (personId, delta) => {
    const box = personBoxes.get(personId);
    if (!box || !delta) {
      return;
    }

    box.x += delta;
    (tree.childrenByParent.get(personId) || []).forEach((childId) => {
      shiftSubtree(childId, delta);
    });
  };

  const getSubtreeContours = (personId) => {
    const box = personBoxes.get(personId);
    if (!box) {
      return null;
    }

    const level = tree.generationLevels[personId] || 0;
    const contours = {
      [level]: {
        left: box.x,
        right: box.x + box.width
      }
    };

    (tree.childrenByParent.get(personId) || []).forEach((childId) => {
      const childContours = getSubtreeContours(childId);
      if (!childContours) {
        return;
      }

      Object.entries(childContours).forEach(([childLevel, bounds]) => {
        if (!contours[childLevel]) {
          contours[childLevel] = { ...bounds };
          return;
        }

        contours[childLevel].left = Math.min(contours[childLevel].left, bounds.left);
        contours[childLevel].right = Math.max(contours[childLevel].right, bounds.right);
      });
    });

    return contours;
  };

  const mergeContours = (baseContours, nextContours) => {
    const merged = {};

    Object.entries(baseContours || {}).forEach(([level, bounds]) => {
      merged[level] = { ...bounds };
    });

    Object.entries(nextContours || {}).forEach(([level, bounds]) => {
      if (!merged[level]) {
        merged[level] = { ...bounds };
        return;
      }

      merged[level].left = Math.min(merged[level].left, bounds.left);
      merged[level].right = Math.max(merged[level].right, bounds.right);
    });

    return merged;
  };

  const compactSiblingSet = (personIds) => {
    let accumulatedContours = null;

    personIds.forEach((personId) => {
      let contours = getSubtreeContours(personId);
      if (!contours) {
        return;
      }

      if (accumulatedContours) {
        let shift = Number.NEGATIVE_INFINITY;

        Object.entries(contours).forEach(([level, bounds]) => {
          const previous = accumulatedContours[level];
          if (!previous) {
            return;
          }

          shift = Math.max(shift, previous.right + boxGap - bounds.left);
        });

        if (shift !== Number.NEGATIVE_INFINITY && shift < 0) {
          shiftSubtree(personId, shift);
          contours = getSubtreeContours(personId);
        }
      }

      accumulatedContours = mergeContours(accumulatedContours, contours);
    });
  };

  const recenterParent = (personId) => {
    const box = personBoxes.get(personId);
    const childIds = tree.childrenByParent.get(personId) || [];
    if (!box || !childIds.length) {
      return;
    }

    const firstChild = personBoxes.get(childIds[0]);
    const lastChild = personBoxes.get(childIds[childIds.length - 1]);
    if (!firstChild || !lastChild) {
      return;
    }

    const desiredCenter = ((firstChild.x + firstChild.width / 2) + (lastChild.x + lastChild.width / 2)) / 2;
    box.x = desiredCenter - box.width / 2;
  };

  const compactTree = (personId) => {
    const childIds = tree.childrenByParent.get(personId) || [];
    childIds.forEach(compactTree);
    compactSiblingSet(childIds);
    recenterParent(personId);
  };

  tree.roots.forEach(compactTree);
  compactSiblingSet(tree.roots);

  let minX = 0;
  let maxX = 0;
  let maxY = 0;
  personBoxes.forEach((box) => {
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  });

  if (minX < 0) {
    const delta = Math.abs(minX) + 20;
    personBoxes.forEach((box) => {
      box.x += delta;
    });
    maxX += delta;
  }

  return {
    personBoxes,
    generationHeights,
    generationTops,
    bounds: {
      width: maxX + 60,
      height: maxY + 80
    }
  };
}

function measurePersonBox(person, ctx) {
  const lines = person.lines.length ? person.lines : [person.id];
  const paddingX = 10;
  const paddingTop = 8;
  const lineHeight = 14;
  const maxContentWidth = person.wrap ? person.wrapWidth : null;
  const displayLines = [];
  let width = 36;

  ctx.save();
  lines.forEach((line, index) => {
    const wrappedLines = getDisplayLines(ctx, line, index === 0, maxContentWidth);
    wrappedLines.forEach((displayLine) => {
      width = Math.max(width, measureLineWidth(ctx, displayLine, index === 0));
      displayLines.push({
        ...displayLine,
        isNameLine: index === 0
      });
    });
  });
  ctx.restore();

  return {
    width: Math.ceil(width + paddingX * 2),
    height: paddingTop * 2 + displayLines.length * lineHeight,
    displayLines
  };
}

function getDisplayLines(ctx, line, isNameLine, maxContentWidth) {
  const parts = Array.isArray(line.parts) && line.parts.length
    ? line.parts
    : [{ text: line.text || "", underline: Boolean(line.underline) }];

  if (!maxContentWidth) {
    return [{
      text: line.text || parts.map((part) => part.text).join(""),
      parts
    }];
  }

  const tokens = tokenizeLineParts(parts);
  const wrapped = [];
  let currentParts = [];
  let currentWidth = 0;

  tokens.forEach((token) => {
    const tokenParts = token.parts;
    const tokenWidth = measurePartsWidth(ctx, tokenParts, isNameLine);

    if (!currentParts.length) {
      currentParts = cloneParts(tokenParts);
      currentWidth = tokenWidth;
      return;
    }

    if (currentWidth + tokenWidth <= maxContentWidth) {
      currentParts = currentParts.concat(cloneParts(tokenParts));
      currentWidth += tokenWidth;
      return;
    }

    wrapped.push({
      text: currentParts.map((part) => part.text).join(""),
      parts: trimTrailingSpaces(currentParts)
    });
    currentParts = cloneParts(trimLeadingSpaces(tokenParts));
    currentWidth = measurePartsWidth(ctx, currentParts, isNameLine);
  });

  if (currentParts.length) {
    wrapped.push({
      text: currentParts.map((part) => part.text).join(""),
      parts: trimTrailingSpaces(currentParts)
    });
  }

  return wrapped.length ? wrapped : [{
    text: line.text || parts.map((part) => part.text).join(""),
    parts
  }];
}

function tokenizeLineParts(parts) {
  const tokens = [];

  parts.forEach((part) => {
    const segments = String(part.text || "").match(/\S+\s*|\s+/g) || [];
    segments.forEach((segment) => {
      tokens.push({
        parts: [{
          text: segment,
          underline: Boolean(part.underline),
          bold: Boolean(part.bold)
        }]
      });
    });
  });

  return tokens;
}

function cloneParts(parts) {
  return parts.map((part) => ({
    text: part.text,
    underline: Boolean(part.underline),
    bold: Boolean(part.bold)
  }));
}

function trimLeadingSpaces(parts) {
  const next = cloneParts(parts);
  if (next.length) {
    next[0].text = next[0].text.replace(/^\s+/, "");
  }
  return next.filter((part) => part.text);
}

function trimTrailingSpaces(parts) {
  const next = cloneParts(parts);
  if (next.length) {
    const lastIndex = next.length - 1;
    next[lastIndex].text = next[lastIndex].text.replace(/\s+$/, "");
  }
  return next.filter((part) => part.text);
}

function measurePartsWidth(ctx, parts, isNameLine) {
  return parts.reduce((sum, part) => sum + measureTextWidth(ctx, part.text, isNameLine, Boolean(part.bold)), 0);
}

function measureTextWidth(ctx, text, isNameLine, isBold) {
  ctx.font = isNameLine || isBold ? "700 11px 'Times New Roman'" : "11px 'Times New Roman'";
  return ctx.measureText(text).width;
}

function measureLineWidth(ctx, line, isNameLine) {
  const parts = Array.isArray(line.parts) && line.parts.length
    ? line.parts
    : [{ text: line.text || "", underline: Boolean(line.underline) }];

  return measurePartsWidth(ctx, parts, isNameLine);
}

function fitToViewport(state) {
  if (!state.geometry) {
    return;
  }

  const viewportWidth = state.canvas.width / state.dpr;
  const viewportHeight = state.canvas.height / state.dpr;
  const scaleX = (viewportWidth - 40) / state.geometry.bounds.width;
  const scaleY = (viewportHeight - 40) / state.geometry.bounds.height;
  const scale = clamp(Math.min(scaleX, scaleY, 1), 0.2, 1);

  state.viewport.scale = scale;
  state.viewport.offsetX = (viewportWidth - state.geometry.bounds.width * scale) / 2;
  state.viewport.offsetY = 18;
}

function zoomBy(state, factor) {
  const viewportWidth = state.canvas.width / state.dpr;
  const viewportHeight = state.canvas.height / state.dpr;
  const anchorX = viewportWidth / 2;
  const anchorY = viewportHeight / 2;
  const oldScale = state.viewport.scale;
  const newScale = clamp(oldScale * factor, 0.25, 3.5);
  const worldX = (anchorX - state.viewport.offsetX) / oldScale;
  const worldY = (anchorY - state.viewport.offsetY) / oldScale;

  state.viewport.scale = newScale;
  state.viewport.offsetX = anchorX - worldX * newScale;
  state.viewport.offsetY = anchorY - worldY * newScale;
  drawTree(state);
}

function drawTree(state) {
  const { ctx, canvas, dpr } = state;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawPaperBackground(ctx, width, height);

  ctx.save();
  ctx.translate(state.viewport.offsetX, state.viewport.offsetY);
  ctx.scale(state.viewport.scale, state.viewport.scale);

  drawChildLinks(ctx, state);

  ctx.restore();
  renderTextOverlay(state);
}

function drawPaperBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#f8f2e7");
  gradient.addColorStop(1, "#efe2cc");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawChildLinks(ctx, state) {
  ctx.save();
  ctx.strokeStyle = "#8d7b61";
  ctx.lineWidth = 1;

  state.tree.childrenByParent.forEach((childIds, parentId) => {
    const parentBox = state.geometry.personBoxes.get(parentId);
    if (!parentBox || !childIds.length) {
      return;
    }

    const orderedChildren = childIds
      .map((childId) => state.geometry.personBoxes.get(childId))
      .filter(Boolean);

    if (!orderedChildren.length) {
      return;
    }

    const branchY = parentBox.y + parentBox.height + 16;
    const leftX = orderedChildren[0].x + orderedChildren[0].width / 2;
    const rightX = orderedChildren[orderedChildren.length - 1].x + orderedChildren[orderedChildren.length - 1].width / 2;
    const parentCenterX = parentBox.x + parentBox.width / 2;

    ctx.beginPath();
    ctx.moveTo(parentCenterX, parentBox.y + parentBox.height);
    ctx.lineTo(parentCenterX, branchY);
    ctx.moveTo(leftX, branchY);
    ctx.lineTo(rightX, branchY);
    ctx.stroke();

    orderedChildren.forEach((childBox) => {
      const childCenterX = childBox.x + childBox.width / 2;
      const marker = state.tree.childMarkersByParent.get(parentId)?.get(childBox.person.id) || "";
      ctx.beginPath();
      ctx.moveTo(childCenterX, branchY);
      ctx.lineTo(childCenterX, childBox.y);
      ctx.stroke();

      if (marker) {
        drawChildMarker(ctx, childCenterX, branchY - 6, marker, orderedChildren.length === 1);
      }
    });
  });

  ctx.restore();
}

function drawChildMarker(ctx, centerX, baselineY, marker, isSingleChild) {
  ctx.save();
  ctx.font = "11px 'Times New Roman'";
  ctx.fillStyle = "#5f4f3b";
  const width = ctx.measureText(marker).width;
  const offsetX = isSingleChild ? 12 : 0;
  ctx.fillText(marker, centerX - width / 2 + offsetX, baselineY);
  ctx.restore();
}

function renderTextOverlay(state) {
  const { textLayer, geometry, viewport } = state;
  if (!textLayer || !geometry) {
    return;
  }

  const fragment = document.createDocumentFragment();

  geometry.personBoxes.forEach((box) => {
    const element = document.createElement("div");
    element.className = "tree-text-box";
    element.style.left = `${viewport.offsetX + box.x * viewport.scale}px`;
    element.style.top = `${viewport.offsetY + box.y * viewport.scale}px`;
    element.style.width = `${box.width * viewport.scale}px`;
    element.style.minHeight = `${box.height * viewport.scale}px`;
    element.style.fontSize = `${11 * viewport.scale}px`;
    element.style.lineHeight = `${14 * viewport.scale}px`;
    element.style.padding = `${8 * viewport.scale}px ${10 * viewport.scale}px`;
    if (box.person.link?.href) {
      element.classList.add("is-linked");
      element.dataset.href = box.person.link.href;
      element.title = "Open linked tree";
    }

    (box.displayLines || []).forEach((line, index) => {
      const lineElement = document.createElement("span");
      lineElement.className = `tree-text-line${line.isNameLine ? " is-name" : ""}`;

      const parts = Array.isArray(line.parts) && line.parts.length
        ? line.parts
        : [{ text: line.text || "", underline: Boolean(line.underline) }];

      parts.forEach((part) => {
        const partElement = document.createElement("span");
        partElement.className = `tree-text-part${part.underline ? " is-underlined" : ""}${part.bold ? " is-bold" : ""}`;
        partElement.textContent = part.text;
        lineElement.appendChild(partElement);
      });

      element.appendChild(lineElement);
    });

    fragment.appendChild(element);
  });

  textLayer.replaceChildren(fragment);
}

function renderSources(tree) {
  const panel = document.getElementById("sourcePanel");

  if (!tree.sources.length) {
    panel.innerHTML = `
      <h2>Sources</h2>
      <p>No sources recorded for this tree.</p>
    `;
    return;
  }

  panel.innerHTML = `
    <h2>Sources</h2>
    ${tree.sources.map(renderSource).join("")}
  `;
}

function renderSource(source) {
  return `
    <div class="source-block">
      <p>${source.text}</p>
      ${source.note ? `<p class="muted">${source.note}</p>` : ""}
    </div>
  `;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
