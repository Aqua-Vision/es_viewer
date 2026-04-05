let DATA = null;

fetch("data/volumes.json")
  .then((res) => res.json())
  .then((data) => {
    DATA = data;
    renderVolumes();
  })
  .catch((err) => {
    document.getElementById("volumes").textContent = "Failed to load data.";
    console.error(err);
  });

function renderVolumes() {
  const container = document.getElementById("volumes");
  container.innerHTML = "";

  DATA.volumes.forEach((volume) => {
    const btn = document.createElement("button");
    btn.replaceChildren(buildInlineFormattedLabel(volume.title));
    btn.onclick = () => renderTrees(volume);
    container.appendChild(btn);
  });
}

function renderTrees(volume) {
  const container = document.getElementById("trees");
  container.classList.remove("muted");
  container.innerHTML = "";

  volume.trees.forEach((tree) => {
    const link = document.createElement("a");
    link.className = "tree-link";
    link.replaceChildren(buildInlineFormattedLabel(tree.name));
    link.href = `viewer.html?volume=${encodeURIComponent(volume.id)}&tree=${encodeURIComponent(tree.id)}`;
    container.appendChild(link);
  });
}

function buildInlineFormattedLabel(text) {
  const fragment = document.createDocumentFragment();
  const value = String(text || "");
  const pattern = /(\*\*.+?\*\*)/g;
  let lastIndex = 0;
  let match = null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }

    const strong = document.createElement("strong");
    strong.textContent = match[0].slice(2, -2);
    fragment.appendChild(strong);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  }

  if (!fragment.childNodes.length) {
    fragment.appendChild(document.createTextNode(value));
  }

  return fragment;
}
