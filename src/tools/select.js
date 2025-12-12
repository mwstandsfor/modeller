import * as THREE from 'three';

/**
 * Face selection tool
 * Click on faces to select them for extrusion
 * Shift+click to add/remove from selection
 */
export class SelectTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    // Visual feedback - using design colors
    this.highlightMeshes = [];
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Face Selection overlay
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false
    });

    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,  // SelectionBorder
      linewidth: 2
    });

    this.outlineMeshes = [];

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

    // Enable controls for wheel zoom and rotation
    this.sceneManager.setControlsEnabled(true);
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
    const isShiftClick = e.shiftKey;

    if (face) {
      if (isShiftClick) {
        // Toggle face in selection
        this.toggleFaceSelection(face);
      } else {
        // Clear selection and select only this face
        this.selectFace(face);
      }
    } else if (!isShiftClick) {
      // Clear selection when clicking empty space (without shift)
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

  /**
   * Select a single face (clear previous selection)
   */
  selectFace(face) {
    // Clear previous selection
    this.selectedFaces = [];

    if (face) {
      this.selectedFaces = [face];
    }

    // Update mesh selection state
    this.editableMesh.faces.forEach(f => f.selected = false);
    if (face) {
      face.selected = true;
    }

    // Update visual
    this.updateHighlight();

    // Callback
    if (this.onSelect) {
      this.onSelect(this.selectedFaces);
    }
  }

  /**
   * Toggle face in multi-selection
   */
  toggleFaceSelection(face) {
    const index = this.selectedFaces.findIndex(f => f.id === face.id);

    if (index >= 0) {
      // Remove from selection
      this.selectedFaces.splice(index, 1);
      face.selected = false;
    } else {
      // Add to selection
      this.selectedFaces.push(face);
      face.selected = true;
    }

    // Update visual
    this.updateHighlight();

    // Callback
    if (this.onSelect) {
      this.onSelect(this.selectedFaces);
    }
  }

  /**
   * Check if a face is selected
   */
  isFaceSelected(face) {
    return this.selectedFaces.some(f => f.id === face.id);
  }

  /**
   * Get selected faces
   */
  getSelectedFaces() {
    return this.selectedFaces;
  }

  clearSelection() {
    if (this.editableMesh) {
      this.editableMesh.faces.forEach(f => f.selected = false);
    }
    this.selectedFaces = [];
    this.clearHighlight();

    if (this.onSelect) {
      this.onSelect([]);
    }
  }

  updateHighlight() {
    this.clearHighlight();

    if (this.selectedFaces.length === 0) return;

    // Create highlight for each selected face
    this.selectedFaces.forEach(face => {
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

      const highlightMesh = new THREE.Mesh(geometry, this.highlightMaterial);
      highlightMesh.renderOrder = 999;
      this.sceneManager.add(highlightMesh);
      this.highlightMeshes.push(highlightMesh);

      // Create outline
      const outlinePositions = [];
      face.vertices.forEach(v => {
        outlinePositions.push(v.x, v.y, v.z);
      });
      // Close the loop
      outlinePositions.push(face.vertices[0].x, face.vertices[0].y, face.vertices[0].z);

      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

      const outlineMesh = new THREE.Line(outlineGeometry, this.outlineMaterial);
      outlineMesh.renderOrder = 1000;
      this.sceneManager.add(outlineMesh);
      this.outlineMeshes.push(outlineMesh);
    });
  }

  clearHighlight() {
    this.highlightMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.highlightMeshes = [];

    this.outlineMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.outlineMeshes = [];
  }

  updateHover(face) {
    this.clearHover();

    // Don't hover on selected faces
    if (!face || this.isFaceSelected(face)) return;

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
