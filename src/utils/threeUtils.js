import * as THREE from 'three';

export function createTextureFromCanvas(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  try {
    texture.colorSpace = THREE.SRGBColorSpace;
  } catch (e) {
    // older three.js versions may not have colorSpace
  }
  return texture;
}

export function createTextureFromImage(img) {
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return createTextureFromCanvas(canvas);
}

export function computePlaneSize(pixelWidth, pixelHeight, maxSize = 2) {
  const aspect = pixelWidth / pixelHeight;
  let width, height;
  if (aspect > 1) {
    width = maxSize;
    height = maxSize / aspect;
  } else {
    height = maxSize;
    width = maxSize * aspect;
  }
  return { width, height };
}

export function applyTextureToMesh(mesh, canvas, maxSize = 2) {
  if (!mesh || !canvas) return null;

  const { width, height } = computePlaneSize(canvas.width, canvas.height, maxSize);

  // Dispose old geometry and create a new one
  if (mesh.geometry) {
    try { mesh.geometry.dispose(); } catch (e) {}
  }
  mesh.geometry = new THREE.PlaneGeometry(width, height);

  // Create texture and apply
  const texture = createTextureFromCanvas(canvas);
  if (mesh.material && mesh.material.map) {
    try { mesh.material.map.dispose(); } catch (e) {}
  }
  if (mesh.material) {
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }

  return texture;
}

export function createPreviewMeshFromCanvas(canvas, maxSize = 2) {
  const texture = createTextureFromCanvas(canvas);
  const { width, height } = computePlaneSize(canvas.width, canvas.height, maxSize);
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (material.map) {
    try { material.map.dispose(); } catch (e) {}
  }
  try { material.dispose(); } catch (e) {}
}

export function disposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) {
    try { mesh.geometry.dispose(); } catch (e) {}
  }
  if (mesh.material) {
    disposeMaterial(mesh.material);
  }
}
