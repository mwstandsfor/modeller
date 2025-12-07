import * as THREE from 'three';

/**
 * Face selection tool
 * Click on faces to select them for extrusion
 */
export class SelectTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFace = null;

    // Visual feedback
    this.highlightMesh = null;
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a90d9,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthTest: false
    });

    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x4a90d9,
      linewidth: 2
    });

    this.outlineMesh = null;

    // Hover highlight
    this.hoverMesh = null;
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthTest: false
    });

    // Callbacks
    this.onSelect = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
  }

  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  activate(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
  }

  deactivate() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    }
    this.clearHighlight();
    this.clearHover();
  }

  handlePointerDown(e) {
    if (!this.editableMesh) return;

    const face = this.raycastFace(e.clientX, e.clientY);

    if (face) {
      this.selectFace(face);
    } else {
      this.clearSelection();
    }
  }

  handlePointerMove(e) {
    if (!this.editableMesh) return;

    const face = this.raycastFace(e.clientX, e.clientY);
    this.updateHover(face);
  }

  /**
   * Raycast to find which face was clicked
   */
  raycastFace(screenX, screenY) {
    if (!this.editableMesh || !this.editableMesh.mesh) return null;

    const ndc = this.sceneManager.screenToNDC(screenX, screenY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);

    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return null;

    const hitPoint = intersects[0].point;

    // Find which face contains this point
    for (const face of this.editableMesh.faces) {
      if (this.editableMesh.isPointInFace(hitPoint, face)) {
        return face;
      }
    }

    // Fallback: find closest face center
    let closestFace = null;
    let minDistance = Infinity;

    for (const face of this.editableMesh.faces) {
      const center = face.getCenter();
      const distance = hitPoint.distanceTo(center);
      if (distance < minDistance) {
        minDistance = distance;
        closestFace = face;
      }
    }

    return closestFace;
  }

  selectFace(face) {
    // Update mesh selection state
    this.editableMesh.selectFace(face);
    this.selectedFace = face;

    // Update visual
    this.updateHighlight(face);

    // Callback
    if (this.onSelect) {
      this.onSelect(face);
    }
  }

  clearSelection() {
    if (this.editableMesh) {
      this.editableMesh.selectFace(null);
    }
    this.selectedFace = null;
    this.clearHighlight();

    if (this.onSelect) {
      this.onSelect(null);
    }
  }

  updateHighlight(face) {
    this.clearHighlight();

    if (!face) return;

    // Create highlight mesh
    const positions = [];
    face.vertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });

    const indices = [];
    for (let i = 1; i < face.vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);

    this.highlightMesh = new THREE.Mesh(geometry, this.highlightMaterial);
    this.highlightMesh.renderOrder = 999;
    this.sceneManager.add(this.highlightMesh);

    // Create outline
    const outlinePositions = [];
    face.vertices.forEach(v => {
      outlinePositions.push(v.x, v.y, v.z);
    });
    // Close the loop
    outlinePositions.push(face.vertices[0].x, face.vertices[0].y, face.vertices[0].z);

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

    this.outlineMesh = new THREE.Line(outlineGeometry, this.outlineMaterial);
    this.outlineMesh.renderOrder = 1000;
    this.sceneManager.add(this.outlineMesh);
  }

  clearHighlight() {
    if (this.highlightMesh) {
      this.sceneManager.remove(this.highlightMesh);
      this.highlightMesh.geometry.dispose();
      this.highlightMesh = null;
    }

    if (this.outlineMesh) {
      this.sceneManager.remove(this.outlineMesh);
      this.outlineMesh.geometry.dispose();
      this.outlineMesh = null;
    }
  }

  updateHover(face) {
    this.clearHover();

    // Don't hover on selected face
    if (!face || face === this.selectedFace) return;

    const positions = [];
    face.vertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });

    const indices = [];
    for (let i = 1; i < face.vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);

    this.hoverMesh = new THREE.Mesh(geometry, this.hoverMaterial);
    this.hoverMesh.renderOrder = 998;
    this.sceneManager.add(this.hoverMesh);
  }

  clearHover() {
    if (this.hoverMesh) {
      this.sceneManager.remove(this.hoverMesh);
      this.hoverMesh.geometry.dispose();
      this.hoverMesh = null;
    }
  }

  dispose() {
    this.deactivate();
    this.highlightMaterial.dispose();
    this.hoverMaterial.dispose();
    this.outlineMaterial.dispose();
  }
}
