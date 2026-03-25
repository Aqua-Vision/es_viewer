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
    btn.textContent = volume.title;
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
    link.textContent = tree.name;
    link.href = `viewer.html?volume=${encodeURIComponent(volume.id)}&tree=${encodeURIComponent(tree.id)}`;
    container.appendChild(link);
  });
}